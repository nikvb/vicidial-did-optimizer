// Prepaid credit: card top-ups and USDT (TRC-20) deposits.
// Mounted at /api/v1/billing — endpoints: /credit, /topup, /crypto/*.
import express from 'express';
import { body, validationResult } from 'express-validator';
import Tenant from '../models/Tenant.js';
import Invoice from '../models/Invoice.js';
import CryptoPayment from '../models/CryptoPayment.js';
import CreditTransaction from '../models/CreditTransaction.js';
import { asyncHandler, createError } from '../middleware/errorHandler.js';
import { authenticate } from '../middleware/auth.js';
import { chargePaymentToken } from '../services/billing/paypalCharging.js';
import { creditTenant, getCreditBalanceCents } from '../services/billing/creditService.js';
import { getTenantTronAddress, getIncomingUsdt, activateAddressIfNeeded, USDT_CONTRACT } from '../services/billing/tronWallet.js';

const router = express.Router();
router.use(authenticate);

const TOPUP_MIN_USD = 5;
const TOPUP_MAX_USD = 5000;
// Deducted from USDT deposits to cover address activation TRX + sweep fees
const GAS_FEE_USDT = 2;

// @desc    Credit balance + recent ledger
// @route   GET /api/v1/billing/credit
router.get('/credit', asyncHandler(async (req, res) => {
  const tenantId = req.user.tenant._id;
  const balanceCents = await getCreditBalanceCents(tenantId);
  const transactions = await CreditTransaction.find({ tenantId })
    .sort({ createdAt: -1 })
    .limit(20)
    .lean();

  res.json({
    success: true,
    data: {
      balanceCents,
      balanceUsd: balanceCents / 100,
      transactions: transactions.map(t => ({
        id: t._id,
        type: t.type,
        amountUsd: t.amountCents / 100,
        balanceAfterUsd: t.balanceAfterCents / 100,
        reference: t.reference,
        createdAt: t.createdAt
      }))
    }
  });
}));

// @desc    Top up credit balance by charging the saved card
// @route   POST /api/v1/billing/topup
router.post('/topup', [
  body('amount').isFloat({ min: TOPUP_MIN_USD, max: TOPUP_MAX_USD })
    .withMessage(`Amount must be between $${TOPUP_MIN_USD} and $${TOPUP_MAX_USD}`)
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) throw createError.badRequest(errors.array()[0].msg);

  const amount = Math.round(Number(req.body.amount) * 100) / 100;
  const tenant = await Tenant.findById(req.user.tenant._id);
  const paymentMethod = tenant.getPrimaryPaymentMethod();
  if (!paymentMethod) {
    throw createError.badRequest('No saved payment method. Add a card first.');
  }

  const invoiceNumber = `DIDS-AMDY-FUNDS-${Date.now()}`;

  // Customer-initiated one-time charge; chargePaymentToken throws unless the
  // CAPTURE is COMPLETED (order COMPLETED alone never credits balance).
  const chargeResult = await chargePaymentToken(
    paymentMethod.vaultId,
    amount,
    'USD',
    `Account funds (+$${amount.toFixed(2)})`,
    {
      initiatedBy: 'customer',
      firstUse: !paymentMethod.lastUsedAt,
      invoiceId: invoiceNumber,
      customId: `didopt-funds-${tenant._id}`
    }
  );

  paymentMethod.lastUsedAt = new Date();
  await tenant.save();

  const amountCents = Math.round(amount * 100);
  const balanceAfterCents = await creditTenant(
    tenant._id, amountCents, 'topup_card', chargeResult.transactionId
  );

  // Paid invoice record so the top-up shows in billing history and matches
  // the PayPal statement line (invoiceNumber is sent as PayPal invoice_id).
  const now = new Date();
  await Invoice.create({
    tenantId: tenant._id,
    invoiceNumber,
    status: 'paid',
    billingPeriod: { start: now, end: now },
    subscription: { plan: tenant.subscription?.plan || 'payg', baseFee: 0, billingCycle: 'monthly' },
    didCharges: { didCount: 0, includedDids: 0, extraDids: 0, perDidRate: 0, totalDidFee: 0 },
    amounts: { subtotal: amount, tax: 0, total: amount },
    paymentDetails: {
      provider: 'paypal',
      transactionId: chargeResult.transactionId,
      paypalOrderId: chargeResult.orderId,
      paidAt: now,
      paymentMethodId: paymentMethod._id
    },
    metadata: { dueDate: now, notes: 'Credit balance top-up' }
  });

  res.json({
    success: true,
    data: {
      chargedUsd: amount,
      balanceCents: balanceAfterCents,
      balanceUsd: balanceAfterCents / 100,
      invoiceNumber
    }
  });
}));

// @desc    Get (or create) the tenant's USDT TRC-20 deposit address + a
//          pending deposit intent to poll against
// @route   POST /api/v1/billing/crypto/payment-address
router.post('/crypto/payment-address', [
  body('amountUsd').isFloat({ min: 1, max: 10000 }).withMessage('amountUsd must be between 1 and 10000')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) throw createError.badRequest(errors.array()[0].msg);

  const tenant = await Tenant.findById(req.user.tenant._id);
  const amountUsd = Math.round(Number(req.body.amountUsd) * 100) / 100;

  let address;
  try {
    address = await getTenantTronAddress(tenant);
  } catch (err) {
    console.error('[crypto/payment-address] wallet error:', err.message);
    throw createError.badRequest('Crypto payments not configured');
  }

  const payment = await CryptoPayment.create({
    tenantId: tenant._id,
    tronAddress: address,
    amountUsd,
    status: 'pending'
  });

  res.json({
    success: true,
    data: {
      address,
      amountUsd,
      usdtContract: USDT_CONTRACT,
      network: 'TRC20 (Tron)',
      gasFeeUsd: GAS_FEE_USDT,
      paymentId: payment._id,
      balanceUsd: (tenant.billing.creditBalanceCents || 0) / 100
    }
  });
}));

// @desc    Poll for the USDT deposit; credits the balance when found.
//          Safe to poll concurrently — crediting is an atomic pending→credited
//          flip, and txHash is globally unique across payments.
// @route   GET /api/v1/billing/crypto/check-payment?paymentId=...
router.get('/crypto/check-payment', asyncHandler(async (req, res) => {
  const tenantId = req.user.tenant._id;
  const { paymentId } = req.query;
  if (!paymentId) throw createError.badRequest('paymentId required');

  const payment = await CryptoPayment.findOne({ _id: paymentId, tenantId });
  if (!payment) throw createError.notFound('Payment not found');

  const respond = async (p) => res.json({
    success: true,
    data: {
      status: p.status,
      amountUsd: p.amountUsdt ?? p.amountUsd,
      txHash: p.txHash,
      balanceUsd: (await getCreditBalanceCents(tenantId)) / 100
    }
  });

  if (payment.status !== 'pending') return respond(payment);

  // Expire intents older than 2h (user can just start a new one)
  const ageMs = Date.now() - payment.createdAt.getTime();
  if (ageMs > 2 * 60 * 60 * 1000) {
    payment.status = 'expired';
    await payment.save();
    return respond(payment);
  }

  // Poll TronGrid for transfers since this intent was created (1 min buffer)
  const transfers = await getIncomingUsdt(payment.tronAddress, payment.createdAt.getTime() - 60_000);

  // Match: at least 99% of the expected amount, and a tx no other payment
  // has claimed (unique txHash index is the backstop against double-credit).
  const usedHashes = new Set(
    (await CryptoPayment.find({ txHash: { $in: transfers.map(t => t.tx_id) } }, 'txHash').lean())
      .map(p => p.txHash)
  );
  const match = transfers.find(
    t => t.amount_usdt >= payment.amountUsd * 0.99 && !usedHashes.has(t.tx_id)
  );
  if (!match) return respond(payment);

  // Atomic claim: only one concurrent poll wins the pending→credited flip.
  let claimed;
  try {
    claimed = await CryptoPayment.findOneAndUpdate(
      { _id: payment._id, status: 'pending' },
      {
        $set: {
          status: 'credited',
          txHash: match.tx_id,
          amountUsdt: match.amount_usdt,
          creditedAt: new Date()
        }
      },
      { new: true }
    );
  } catch (err) {
    if (err.code === 11000) claimed = null; // txHash claimed by another payment
    else throw err;
  }
  if (!claimed) {
    const fresh = await CryptoPayment.findById(payment._id);
    return respond(fresh);
  }

  // Credit balance minus the gas fee (covers activation TRX + sweep costs)
  const creditCents = Math.round(Math.max(0, match.amount_usdt - GAS_FEE_USDT) * 100);
  if (creditCents > 0) {
    await creditTenant(tenantId, creditCents, 'topup_usdt', match.tx_id);
  }

  // Fire-and-forget: make sure the deposit address is activated on-chain so
  // it can be swept later. Never blocks or fails the crediting.
  activateAddressIfNeeded(payment.tronAddress);

  return respond(claimed);
}));

export default router;
