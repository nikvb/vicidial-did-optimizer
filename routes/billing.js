import express from 'express';
import { body, validationResult } from 'express-validator';
import Tenant from '../models/Tenant.js';
import Invoice from '../models/Invoice.js';
import DID from '../models/DID.js';
import { asyncHandler, createError } from '../middleware/errorHandler.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { PRICING_PLANS, calculateMonthlyCharges, calculateEstimate, chargeInvoice, retryPayment } from '../services/billing/billingService.js';
import { vaultCreditCard, deletePaymentToken, getPaymentToken } from '../services/billing/paypalVault.js';
import { chargePaymentToken, verifyPaymentToken } from '../services/billing/paypalCharging.js';

const router = express.Router();

// Helper function to format currency
const formatCurrency = (amount) => {
  if (typeof amount !== 'number') return '$0.00';
  return `$${amount.toFixed(2)}`;
};

// Apply authentication to all routes
router.use(authenticate);

// =====================================================
// PRICING & PLANS
// =====================================================

// @desc    Get pricing plans
// @route   GET /api/v1/billing/pricing
// @access  Private
router.get('/pricing', asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: { plans: PRICING_PLANS }
  });
}));

// (test-paypal-config endpoint removed — it leaked partial live credentials
// to any authenticated user. Admins can verify config via env on the host.)

// @desc    Calculate cost estimate (curve-based — plan no longer affects price)
// @route   POST /api/v1/billing/estimate
// @access  Private
router.post('/estimate', [
  body('didCount').isInt({ min: 0 }).withMessage('DID count must be a positive number'),
  body('billingCycle').optional().isIn(['monthly', 'yearly']).withMessage('Invalid billing cycle')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw createError.badRequest(errors.array()[0].msg);
  }

  const { didCount, billingCycle = 'monthly' } = req.body;

  const estimate = calculateEstimate(didCount, billingCycle);

  res.json({
    success: true,
    data: { estimate }
  });
}));

// =====================================================
// SUBSCRIPTION MANAGEMENT
// =====================================================

// @desc    Get current subscription (curve-based)
// @route   GET /api/v1/billing/subscription
// @access  Private
router.get('/subscription', asyncHandler(async (req, res) => {
  const tenant = await Tenant.findById(req.user.tenant._id);

  if (!tenant) {
    throw createError.notFound('Tenant not found');
  }

  const didCount = await DID.countDocuments({
    tenantId: tenant._id,
    status: 'active',
    isActive: true
  });

  const pricingModule = await import('../services/billing/pricingCurves.js');
  const { getEffectiveRate } = await import('../services/billing/billingService.js');
  const didSource = tenant.subscription?.didSource || 'byo';
  const customRate = tenant.subscription?.perDidPricing?.customRate ?? null;
  const eff = getEffectiveRate(tenant);
  const rate = eff.rate;
  const charge = pricingModule.calculateFlatCharge(didCount, rate);
  const tiers = pricingModule.serializeTiers(pricingModule.DIRECT_TIERS);
  const currentPlan = PRICING_PLANS[tenant.subscription.plan] || PRICING_PLANS.payg;

  res.json({
    success: true,
    data: {
      subscription: tenant.subscription,
      limits: tenant.limits,
      usage: {
        ...tenant.usage,
        didCount,
        currentMonthCharge: charge.totalMonthlyCharge,
        tierBreakdown: charge.breakdown,
        tier: charge.tierName,
        baseFee: 0,
        didCharges: charge.didCharges
      },
      rateInfo: {
        didSource,
        customRate,
        effectiveRate: rate,
        rateSource: eff.source,
        promo: eff.promo,
        rates: pricingModule.FLAT_RATES
      },
      currentPlan,
      pricingTiers: tiers
    }
  });
}));

// @desc    Change billing cycle (PAYG monthly vs annual prepay) — pricing
//         is uniform; only the cycle changes. Annual prepay charges 12 months
//         at 10 months' worth on switch.
// @route   PUT /api/v1/billing/subscription/cycle
// @access  Private
router.put('/subscription/cycle', [
  body('billingCycle').isIn(['monthly', 'yearly']).withMessage('billingCycle must be monthly or yearly')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) throw createError.badRequest(errors.array()[0].msg);

  const tenant = await Tenant.findById(req.user.tenant._id);
  if (!tenant) throw createError.notFound('Tenant not found');

  const { billingCycle } = req.body;
  const oldCycle = tenant.subscription.billingCycle;

  tenant.subscription.billingCycle = billingCycle;
  tenant.subscription.plan = billingCycle === 'yearly' ? 'annual' : 'payg';
  await tenant.save();

  res.json({
    success: true,
    data: { oldCycle, newCycle: billingCycle, plan: tenant.subscription.plan }
  });
}));

// Legacy plan-change endpoint kept for backwards compatibility — pricing is
// now uniform across all plans, so this only flips billingCycle if provided.
router.put('/subscription/plan', [
  body('billingCycle').optional().isIn(['monthly', 'yearly'])
], asyncHandler(async (req, res) => {
  const tenant = await Tenant.findById(req.user.tenant._id);
  if (!tenant) throw createError.notFound('Tenant not found');

  const { billingCycle } = req.body;
  if (billingCycle) {
    tenant.subscription.billingCycle = billingCycle;
    tenant.subscription.plan = billingCycle === 'yearly' ? 'annual' : 'payg';
    await tenant.save();
  }

  res.json({
    success: true,
    message: 'All tenants are on the unified per-DID curve. Use /subscription/cycle to switch between monthly PAYG and annual prepay.',
    data: { subscription: tenant.subscription }
  });
}));

// @desc    Get current usage and charges
// @route   GET /api/v1/billing/usage
// @access  Private
router.get('/usage', asyncHandler(async (req, res) => {
  const tenant = await Tenant.findById(req.user.tenant._id);

  if (!tenant) {
    throw createError.notFound('Tenant not found');
  }

  const charges = await calculateMonthlyCharges(tenant);

  res.json({
    success: true,
    data: { usage: charges }
  });
}));

// =====================================================
// PAYMENT METHODS (VAULTING)
// =====================================================

// @desc    Get all payment methods
// @route   GET /api/v1/billing/payment-methods
// @access  Private
router.get('/payment-methods', asyncHandler(async (req, res) => {
  const tenant = await Tenant.findById(req.user.tenant._id);

  // Sanitize payment methods (don't expose vault tokens)
  const sanitizedMethods = tenant.billing.paymentMethods.map(pm => ({
    id: pm._id,
    type: pm.type,
    isPrimary: pm.isPrimary,
    last4: pm.last4,
    cardType: pm.cardType,
    expiryMonth: pm.expiryMonth,
    expiryYear: pm.expiryYear,
    isActive: pm.isActive,
    addedAt: pm.addedAt,
    lastUsedAt: pm.lastUsedAt
  }));

  res.json({
    success: true,
    data: { paymentMethods: sanitizedMethods }
  });
}));

// @desc    Vault credit card payment method
// @route   POST /api/v1/billing/payment-methods/vault
// @access  Private (users can add their own payment methods)
router.post('/payment-methods/vault', [
  body('cardNumber').notEmpty().withMessage('Card number is required'),
  body('expiryMonth').isInt({ min: 1, max: 12 }).withMessage('Invalid expiry month'),
  body('expiryYear').isInt({ min: new Date().getFullYear() }).withMessage('Invalid expiry year'),
  body('cvv').notEmpty().withMessage('CVV is required'),
  body('billingAddress').notEmpty().withMessage('Billing address is required')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw createError.badRequest(errors.array()[0].msg);
  }

  const { cardNumber, expiryMonth, expiryYear, cvv, billingAddress } = req.body;

  const tenant = await Tenant.findById(req.user.tenant._id);
  if (!tenant) {
    throw createError.notFound('Tenant not found');
  }

  console.log(`💳 Vaulting payment method for ${tenant.name} (card ****${cardNumber ? cardNumber.slice(-4) : '????'})`);

  try {

    // Vault the card using new PayPal Payment Token API
    const vaultResult = await vaultCreditCard({
      number: cardNumber,
      expMonth: expiryMonth,
      expYear: expiryYear,
      cvv: cvv,
      firstName: billingAddress.firstName,
      lastName: billingAddress.lastName,
      addressLine1: billingAddress.street,
      addressLine2: billingAddress.street2,
      city: billingAddress.city,
      state: billingAddress.state,
      postalCode: billingAddress.zipCode,
      countryCode: billingAddress.country || 'US'
    });

    // Store vault token in database using new API response
    const paymentMethod = {
      type: 'credit_card',
      isPrimary: tenant.billing.paymentMethods.length === 0, // First card is primary
      vaultId: vaultResult.tokenId, // New API uses tokenId
      last4: vaultResult.last4,
      cardType: vaultResult.brand ? vaultResult.brand.toLowerCase() : 'unknown',
      expiryMonth,
      expiryYear,
      billingAddress: {
        name: `${billingAddress.firstName} ${billingAddress.lastName}`,
        street: billingAddress.street,
        city: billingAddress.city,
        state: billingAddress.state,
        zipCode: billingAddress.zipCode,
        country: billingAddress.country || 'US'
      },
      isActive: true,
      addedAt: new Date()
    };

    tenant.billing.paymentMethods.push(paymentMethod);
    await tenant.save();

    // ── ACTIVATION: a trial tenant that adds a payment method becomes a
    // paying customer. Prorated charge for the rest of this month, then the
    // monthly cycle takes over on the 1st. (This was the missing trial→active
    // conversion — without it no organic signup was ever billed.)
    let activation = null;
    if (tenant.subscription.status === 'trial') {
      const savedMethod = tenant.billing.paymentMethods[tenant.billing.paymentMethods.length - 1];
      const { activateTenantWithProratedCharge } = await import('../services/billing/billingService.js');
      activation = await activateTenantWithProratedCharge(tenant, savedMethod);
      console.log(`🚀 ${tenant.name}: trial → active (charged=${activation.charged}, amount=$${activation.amount})`);
    }

    res.json({
      success: true,
      message: activation?.activated
        ? (activation.charged
            ? `Payment method added — subscription activated (charged $${activation.amount.toFixed(2)} for the rest of this month)`
            : 'Payment method added — subscription activated')
        : 'Payment method added successfully',
      data: {
        paymentMethod: {
          id: paymentMethod._id,
          type: paymentMethod.type,
          isPrimary: paymentMethod.isPrimary,
          last4: paymentMethod.last4,
          cardType: paymentMethod.cardType,
          expiryMonth: paymentMethod.expiryMonth,
          expiryYear: paymentMethod.expiryYear
        },
        activation: activation ? {
          activated: activation.activated,
          charged: activation.charged,
          amount: activation.amount,
          invoiceNumber: activation.invoice?.invoiceNumber || null
        } : null
      }
    });

  } catch (error) {
    console.error(`❌ Vault payment method failed for ${tenant.name}: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Failed to add payment method',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}));

// @desc    Set primary payment method
// @route   PUT /api/v1/billing/payment-methods/:id/primary
// @access  Private (users can manage their own payment methods)
router.put('/payment-methods/:id/primary', asyncHandler(async (req, res) => {
  const tenant = await Tenant.findById(req.user.tenant._id);
  const { id } = req.params;

  // Set all to non-primary
  tenant.billing.paymentMethods.forEach(pm => {
    pm.isPrimary = pm._id.toString() === id;
  });

  await tenant.save();

  res.json({
    success: true,
    message: 'Primary payment method updated'
  });
}));

// @desc    Test charge a payment method
// @route   POST /api/v1/billing/payment-methods/:id/test-charge
// @access  Admin only — this moves REAL money; capped at $1.00
router.post('/payment-methods/:id/test-charge', requireAdmin, [
  body('amount').isFloat({ min: 0.01, max: 1.00 }).withMessage('Test amount must be between $0.01 and $1.00')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw createError.badRequest(errors.array()[0].msg);
  }

  const tenant = await Tenant.findById(req.user.tenant._id);
  const { id } = req.params;
  const { amount } = req.body;

  // Find payment method
  const paymentMethod = tenant.billing.paymentMethods.find(pm => pm._id.toString() === id);

  if (!paymentMethod) {
    throw createError.notFound('Payment method not found');
  }

  if (!paymentMethod.isActive) {
    throw createError.badRequest('Payment method is not active');
  }

  try {
    // Charge the payment token
    const chargeResult = await chargePaymentToken(
      paymentMethod.vaultId,
      amount,
      'USD',
      `Test charge - ${tenant.name}`
    );

    // Create an invoice record for this test charge
    const now = new Date();
    const invoice = new Invoice({
      tenantId: tenant._id,
      invoiceNumber: `TEST-${Date.now()}`,
      status: 'paid',
      billingPeriod: {
        start: now,
        end: now
      },
      subscription: {
        plan: tenant.billing?.subscription?.plan || 'basic',
        baseFee: 0,
        billingCycle: tenant.billing?.subscription?.billingCycle || 'monthly'
      },
      didCharges: {
        didCount: 0,
        includedDids: 0,
        extraDids: 0,
        perDidRate: 0,
        totalDidFee: 0
      },
      amounts: {
        subtotal: amount,
        tax: 0,
        total: amount
      },
      paymentDetails: {
        provider: 'paypal',
        transactionId: chargeResult.transactionId,
        paypalOrderId: chargeResult.orderId,
        paidAt: new Date(),
        paymentMethodId: paymentMethod._id
      },
      metadata: {
        dueDate: now,
        notes: 'Test charge - for payment method verification'
      }
    });

    await invoice.save();

    // Update payment method last used
    paymentMethod.lastUsedAt = new Date();
    await tenant.save();

    res.json({
      success: true,
      message: 'Test charge successful',
      data: {
        charge: chargeResult,
        invoice: {
          id: invoice._id,
          invoiceNumber: invoice.invoiceNumber,
          amount: invoice.amounts.total,
          status: invoice.status
        }
      }
    });

  } catch (error) {
    console.error('\n❌ ===== TEST CHARGE ENDPOINT ERROR =====');
    console.error('🔴 Error Message:', error.message);
    console.error('🔴 Error Stack:', error.stack);
    console.error('🔴 Token ID:', paymentMethod?.vaultId);
    console.error('🔴 Amount:', amount);
    console.error('🔴 Tenant:', tenant?.name);

    if (error.paypalError) {
      console.error('💳 PayPal Error Details:', JSON.stringify(error.paypalError, null, 2));
    }

    console.error('🔍 Full Error Object:', JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
    console.error('=======================================\n');

    throw createError.badRequest(error.message || 'Charge failed');
  }
}));

// @desc    Verify payment method is valid
// @route   POST /api/v1/billing/payment-methods/:id/verify
// @access  Private
router.post('/payment-methods/:id/verify', asyncHandler(async (req, res) => {
  const tenant = await Tenant.findById(req.user.tenant._id);
  const { id } = req.params;

  // Find payment method
  const paymentMethod = tenant.billing.paymentMethods.find(pm => pm._id.toString() === id);

  if (!paymentMethod) {
    throw createError.notFound('Payment method not found');
  }

  try {
    console.log('\n🔍 ===== VERIFY ENDPOINT CALLED =====');
    console.log('📝 Payment Method ID:', id);
    console.log('📝 Vault ID:', paymentMethod.vaultId);
    console.log('📝 Tenant:', tenant.name);
    console.log('=======================================\n');

    const verification = await verifyPaymentToken(paymentMethod.vaultId);

    console.log('\n✅ ===== VERIFICATION COMPLETE =====');
    console.log('📊 Valid:', verification.valid);
    console.log('📊 Result:', JSON.stringify(verification, null, 2));
    console.log('=======================================\n');

    res.json({
      success: true,
      data: {
        paymentMethodId: id,
        verified: verification.valid,
        details: verification
      }
    });

  } catch (error) {
    console.error('\n❌ ===== VERIFY ENDPOINT ERROR =====');
    console.error('🔴 Error Message:', error.message);
    console.error('🔴 Error Stack:', error.stack);
    console.error('🔴 Token ID:', paymentMethod?.vaultId);
    console.error('🔴 Tenant:', tenant?.name);

    if (error.paypalError) {
      console.error('💳 PayPal Error Details:', JSON.stringify(error.paypalError, null, 2));
    }

    console.error('🔍 Full Error Object:', JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
    console.error('=======================================\n');

    res.json({
      success: false,
      data: {
        paymentMethodId: id,
        verified: false,
        error: error.message,
        details: error
      }
    });
  }
}));

// @desc    Delete payment method
// @route   DELETE /api/v1/billing/payment-methods/:id
// @access  Private (users can manage their own payment methods)
router.delete('/payment-methods/:id', asyncHandler(async (req, res) => {
  const tenant = await Tenant.findById(req.user.tenant._id);
  const { id } = req.params;

  // Find payment method
  const paymentMethodIndex = tenant.billing.paymentMethods.findIndex(
    pm => pm._id.toString() === id
  );

  if (paymentMethodIndex === -1) {
    throw createError.notFound('Payment method not found');
  }

  const paymentMethod = tenant.billing.paymentMethods[paymentMethodIndex];

  if (paymentMethod.isPrimary && tenant.billing.paymentMethods.length > 1) {
    throw createError.badRequest('Cannot delete primary payment method. Set another as primary first.');
  }

  try {
    // Remove from PayPal vault
    await new Promise((resolve, reject) => {
      paypal.creditCard.delete(paymentMethod.vaultId, (error) => {
        if (error) {
          console.warn('PayPal vault deletion warning:', error);
          // Don't fail if PayPal deletion fails
        }
        resolve();
      });
    });
  } catch (error) {
    console.warn('Could not delete from PayPal vault:', error);
  }

  // Remove from database
  tenant.billing.paymentMethods.splice(paymentMethodIndex, 1);
  await tenant.save();

  res.json({
    success: true,
    message: 'Payment method deleted'
  });
}));

// =====================================================
// INVOICES
// =====================================================

// @desc    Get all invoices
// @route   GET /api/v1/billing/invoices
// @access  Private
router.get('/invoices', asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, status } = req.query;

  const query = { tenantId: req.user.tenant._id };
  if (status) query.status = status;

  const invoices = await Invoice.find(query)
    .sort({ createdAt: -1 })
    .limit(limit * 1)
    .skip((page - 1) * limit)
    .exec();

  const count = await Invoice.countDocuments(query);

  res.json({
    success: true,
    data: {
      invoices,
      totalPages: Math.ceil(count / limit),
      currentPage: page,
      total: count
    }
  });
}));

// @desc    Get specific invoice
// @route   GET /api/v1/billing/invoices/:id
// @access  Private
router.get('/invoices/:id', asyncHandler(async (req, res) => {
  const invoice = await Invoice.findOne({
    _id: req.params.id,
    tenantId: req.user.tenant._id
  });

  if (!invoice) {
    throw createError.notFound('Invoice not found');
  }

  res.json({
    success: true,
    data: { invoice }
  });
}));

// @desc    Retry failed payment
// @route   POST /api/v1/billing/invoices/:id/retry
// @access  Private/Admin
router.post('/invoices/:id/retry', requireAdmin, asyncHandler(async (req, res) => {
  const invoice = await Invoice.findOne({
    _id: req.params.id,
    tenantId: req.user.tenant._id
  });

  if (!invoice) {
    throw createError.notFound('Invoice not found');
  }

  if (!invoice.canRetry()) {
    throw createError.badRequest('Invoice cannot be retried (max attempts reached or not in failed status)');
  }

  const result = await retryPayment(invoice);

  res.json({
    success: true,
    message: 'Payment retry successful',
    data: { result }
  });
}));

// =====================================================
// ADMIN: MANUAL BILLING TRIGGER (FOR TESTING)
// =====================================================

// @desc    Manually trigger billing for a tenant (for testing auto-pay)
// @route   POST /api/v1/billing/admin/trigger-billing
// @access  Admin only
router.post('/admin/trigger-billing', requireAdmin, [
  body('tenantId').optional().isMongoId().withMessage('Invalid tenant ID')
], asyncHandler(async (req, res) => {
  const { tenantId } = req.body;
  const { processMonthlyBilling } = await import('../services/billing/billingService.js');

  // If tenantId provided, trigger for that tenant; otherwise for current user's tenant
  const targetTenantId = tenantId || req.user.tenant._id;
  const tenant = await Tenant.findById(targetTenantId);

  if (!tenant) {
    throw createError.notFound('Tenant not found');
  }

  // (was `!status === 'active'`, which always evaluated false and never guarded)
  if (tenant.subscription.status !== 'active') {
    throw createError.badRequest('Tenant subscription is not active');
  }

  console.log(`\n🚀 MANUAL BILLING TRIGGER FOR: ${tenant.name} (${tenant._id})`);

  try {
    const invoice = await processMonthlyBilling(tenant);

    res.json({
      success: true,
      message: `Manual billing triggered successfully for ${tenant.name}`,
      data: {
        tenantId: tenant._id,
        tenantName: tenant.name,
        invoice: {
          id: invoice._id,
          invoiceNumber: invoice.invoiceNumber,
          status: invoice.status,
          amount: invoice.amounts?.total,
          createdAt: invoice.createdAt
        },
        autoPayEnabled: tenant.billing.autoPayEnabled,
        primaryPaymentMethod: tenant.getPrimaryPaymentMethod() ? {
          type: tenant.getPrimaryPaymentMethod().type,
          last4: tenant.getPrimaryPaymentMethod().last4
        } : null
      }
    });
  } catch (error) {
    console.error(`\n❌ Manual billing trigger failed for ${tenant.name}:`, error.message);
    throw createError.badRequest(`Billing failed: ${error.message}`);
  }
}));

// @desc    Get auto-pay status for current tenant
// @route   GET /api/v1/billing/auto-pay-status
// @access  Private
router.get('/auto-pay-status', asyncHandler(async (req, res) => {
  const tenant = await Tenant.findById(req.user.tenant._id);

  const primaryPaymentMethod = tenant.getPrimaryPaymentMethod();

  res.json({
    success: true,
    data: {
      autoPayEnabled: tenant.billing.autoPayEnabled,
      hasPaymentMethod: !!primaryPaymentMethod,
      primaryPaymentMethod: primaryPaymentMethod ? {
        type: primaryPaymentMethod.type,
        last4: primaryPaymentMethod.last4,
        expiryMonth: primaryPaymentMethod.expiryMonth,
        expiryYear: primaryPaymentMethod.expiryYear,
        isActive: primaryPaymentMethod.isActive
      } : null,
      billingSchedule: {
        monthlyBillingDay: '1st of month',
        monthlyBillingTime: '2:00 AM UTC',
        paymentRetryTime: '3:00 AM UTC daily'
      },
      lastInvoiceDate: tenant.billing.lastInvoiceDate,
      nextBillingDate: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1)
    }
  });
}));

// @desc    Toggle auto-pay on/off for current tenant
// @route   PUT /api/v1/billing/auto-pay-settings
// @access  Private
router.put('/auto-pay-settings', [
  body('enabled').isBoolean().withMessage('enabled must be a boolean')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw createError.badRequest(errors.array()[0].msg);
  }

  const tenant = await Tenant.findById(req.user.tenant._id);
  const oldValue = tenant.billing.autoPayEnabled;

  tenant.billing.autoPayEnabled = req.body.enabled;
  await tenant.save();

  console.log(`✅ Auto-pay toggled for ${tenant.name}: ${oldValue} → ${req.body.enabled}`);

  res.json({
    success: true,
    message: `Auto-pay ${req.body.enabled ? 'enabled' : 'disabled'}`,
    data: {
      autoPayEnabled: tenant.billing.autoPayEnabled,
      previousValue: oldValue
    }
  });
}));

// @desc    Reactivate suspended account (self-service after payment recovery)
// @route   POST /api/v1/billing/reactivate
// @access  Private
router.post('/reactivate', asyncHandler(async (req, res) => {
  const tenant = await Tenant.findById(req.user.tenant._id);

  if (!tenant) {
    throw createError.notFound('Tenant not found');
  }

  if (tenant.subscription.status !== 'suspended') {
    throw createError.badRequest('Account is not suspended. No reactivation needed.');
  }

  console.log(`🔄 Reactivating suspended account: ${tenant.name} (${tenant._id})`);

  tenant.isActive = true;
  tenant.subscription.status = 'active';
  tenant.subscription.gracePeriod.currentFailedPayments = 0;
  tenant.subscription.gracePeriod.suspendedAt = null;
  tenant.subscription.gracePeriod.suspensionReason = null;

  await tenant.save();

  console.log(`✅ Account reactivated: ${tenant.name}`);

  res.json({
    success: true,
    message: 'Account reactivated successfully',
    data: {
      tenantId: tenant._id,
      tenantName: tenant.name,
      isActive: tenant.isActive,
      subscriptionStatus: tenant.subscription.status,
      failedPaymentsReset: 0
    }
  });
}));

// =====================================================
// SELF-SERVICE: PAY AN OPEN INVOICE
// =====================================================

// @desc    Pay a pending/failed invoice with the tenant's primary method
// @route   POST /api/v1/billing/invoices/:id/pay
// @access  Private (tenant pays their own invoice)
router.post('/invoices/:id/pay', asyncHandler(async (req, res) => {
  const tenant = await Tenant.findById(req.user.tenant._id);
  const invoice = await Invoice.findOne({ _id: req.params.id, tenantId: tenant._id });

  if (!invoice) throw createError.notFound('Invoice not found');
  if (invoice.status === 'paid') {
    return res.json({ success: true, message: 'Invoice is already paid', data: { status: 'paid' } });
  }
  if (!['pending', 'failed'].includes(invoice.status)) {
    throw createError.badRequest(`Invoice status '${invoice.status}' is not payable`);
  }

  const paymentMethod = tenant.getPrimaryPaymentMethod();
  if (!paymentMethod) throw createError.badRequest('No payment method on file — add one first');

  const { chargeInvoice: doCharge, chargesEnabled: enabled } = await import('../services/billing/billingService.js');
  if (!enabled()) {
    throw createError.badRequest('Payments are temporarily disabled — please try again later');
  }

  await doCharge(invoice, tenant, paymentMethod);

  res.json({
    success: true,
    message: `Invoice ${invoice.invoiceNumber} paid`,
    data: { invoiceNumber: invoice.invoiceNumber, status: 'paid', amount: invoice.amounts.total }
  });
}));

// =====================================================
// ADMIN: DID SOURCE (RATE CLASS) ASSIGNMENT
// =====================================================

// @desc    List tenants with billing rate class (for per-tenant assignment)
// @route   GET /api/v1/billing/admin/tenants
// @access  Admin only
router.get('/admin/tenants', requireAdmin, asyncHandler(async (req, res) => {
  const { rateFor } = await import('../services/billing/pricingCurves.js');
  const tenants = await Tenant.find({}, 'name subscription.status subscription.didSource subscription.perDidPricing.customRate billing.paymentMethods').lean();

  const rows = await Promise.all(tenants.map(async (t) => {
    const didCount = await DID.countDocuments({ tenantId: t._id, status: 'active', isActive: true });
    const didSource = t.subscription?.didSource || 'byo';
    const customRate = t.subscription?.perDidPricing?.customRate ?? null;
    const rate = rateFor(didSource, customRate);
    return {
      tenantId: t._id,
      name: t.name,
      status: t.subscription?.status,
      didSource,
      customRate,
      effectiveRate: rate,
      billableDids: didCount,
      projectedMonthly: +(didCount * rate).toFixed(2),
      hasPaymentMethod: (t.billing?.paymentMethods || []).some(pm => pm.isActive)
    };
  }));

  res.json({ success: true, data: { tenants: rows } });
}));

// @desc    Set a tenant's rate class (provided $0.15 / byo $0.10) or custom rate
// @route   PUT /api/v1/billing/admin/tenants/:id/did-source
// @access  Admin only
router.put('/admin/tenants/:id/did-source', requireAdmin, [
  body('didSource').optional().isIn(['provided', 'byo']).withMessage("didSource must be 'provided' or 'byo'"),
  body('customRate').optional({ nullable: true }).isFloat({ min: 0 }).withMessage('customRate must be >= 0')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) throw createError.badRequest(errors.array()[0].msg);

  const tenant = await Tenant.findById(req.params.id);
  if (!tenant) throw createError.notFound('Tenant not found');

  const { didSource, customRate } = req.body;
  if (didSource !== undefined) tenant.subscription.didSource = didSource;
  if (customRate !== undefined) tenant.subscription.perDidPricing.customRate = customRate; // null clears
  await tenant.save();

  const { rateFor } = await import('../services/billing/pricingCurves.js');
  res.json({
    success: true,
    message: `${tenant.name}: rate class updated`,
    data: {
      tenantId: tenant._id,
      didSource: tenant.subscription.didSource,
      customRate: tenant.subscription.perDidPricing.customRate ?? null,
      effectiveRate: rateFor(tenant.subscription.didSource, tenant.subscription.perDidPricing.customRate)
    }
  });
}));

// NOTE: The PayPal webhook lives in routes/paypal-webhook.js and is mounted in
// server-full.js BEFORE authentication — PayPal's unauthenticated POSTs were
// getting 401 from this router's authenticate middleware and never processed.

export default router;
