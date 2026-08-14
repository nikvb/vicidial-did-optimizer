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
import fs from 'fs';

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

// @desc    Test PayPal configuration
// @route   GET /api/v1/billing/test-paypal-config
// @access  Private
router.get('/test-paypal-config', asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: {
      clientId: process.env.PAYPAL_CLIENT_ID?.substring(0, 30) + '...',
      clientIdLength: process.env.PAYPAL_CLIENT_ID?.length,
      secretConfigured: !!process.env.PAYPAL_CLIENT_SECRET,
      secretLength: process.env.PAYPAL_CLIENT_SECRET?.length,
      secretFirst20: process.env.PAYPAL_CLIENT_SECRET?.substring(0, 20) + '...',
      mode: process.env.PAYPAL_MODE
    }
  });
}));

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
    isActive: true
  });

  const pricingModule = await import('../services/billing/pricingCurves.js');
  const charge = pricingModule.calculateDirectCharge(didCount);
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
        baseFee: charge.baseFee,
        didCharges: charge.didCharges
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
  // Log at the VERY START
  try {
    const startLog = `ROUTE HIT: ${new Date().toISOString()}\nClient ID: ${process.env.PAYPAL_CLIENT_ID?.substring(0,30)}\nSecret: ${process.env.PAYPAL_CLIENT_SECRET?.substring(0,20)}\n\n`;
    fs.writeFileSync('/tmp/route-start.log', startLog, { flag: 'a' });
  } catch (e) { /* ignore */ }

  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw createError.badRequest(errors.array()[0].msg);
  }

  const envLog = `
===== VAULT ENDPOINT HIT (${new Date().toISOString()}) =====
PayPal Client ID: ${process.env.PAYPAL_CLIENT_ID?.substring(0, 30)}... (length: ${process.env.PAYPAL_CLIENT_ID?.length})
PayPal Secret: ${process.env.PAYPAL_CLIENT_SECRET?.substring(0, 20)}... (length: ${process.env.PAYPAL_CLIENT_SECRET?.length})
PayPal Mode: ${process.env.PAYPAL_MODE}
User: ${req.user.email}
=====================================
`;
  fs.writeFileSync('/tmp/vault-endpoint-debug.log', envLog, { flag: 'a' });

  const { cardNumber, expiryMonth, expiryYear, cvv, billingAddress } = req.body;

  console.log('\n📋 Parsed request data:');
  console.log('  - Card Number:', cardNumber ? '****' + cardNumber.slice(-4) : 'MISSING');
  console.log('  - Expiry Month:', expiryMonth);
  console.log('  - Expiry Year:', expiryYear);
  console.log('  - CVV:', cvv ? '***' : 'MISSING');
  console.log('  - Billing Address:', billingAddress ? 'Present' : 'MISSING');
  if (billingAddress) {
    console.log('    • First Name:', billingAddress.firstName);
    console.log('    • Last Name:', billingAddress.lastName);
    console.log('    • Street:', billingAddress.street);
    console.log('    • City:', billingAddress.city);
    console.log('    • State:', billingAddress.state);
    console.log('    • ZIP:', billingAddress.zipCode);
    console.log('    • Country:', billingAddress.country);
  }

  console.log('\n🔍 Fetching tenant from database...');
  const tenant = await Tenant.findById(req.user.tenant._id);

  if (!tenant) {
    console.error('❌ Tenant not found!');
    throw createError.notFound('Tenant not found');
  }

  console.log('✅ Tenant found:', tenant.name);
  console.log('  - Tenant ID:', tenant._id);
  console.log('  - Current payment methods:', tenant.billing?.paymentMethods?.length || 0);

  try {
    console.log('\n💳 Calling vaultCreditCard function...');

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

    res.json({
      success: true,
      message: 'Payment method added successfully',
      data: {
        paymentMethod: {
          id: paymentMethod._id,
          type: paymentMethod.type,
          isPrimary: paymentMethod.isPrimary,
          last4: paymentMethod.last4,
          cardType: paymentMethod.cardType,
          expiryMonth: paymentMethod.expiryMonth,
          expiryYear: paymentMethod.expiryYear
        }
      }
    });

  } catch (error) {
    const errorLog = `
❌ BILLING ROUTE ERROR (${new Date().toISOString()})
Error type: ${error.constructor.name}
Error message: ${error.message}
Error stack: ${error.stack}
PayPal Client ID in env: ${process.env.PAYPAL_CLIENT_ID?.substring(0, 30)}... (${process.env.PAYPAL_CLIENT_ID?.length})
PayPal Secret in env: ${process.env.PAYPAL_CLIENT_SECRET?.substring(0, 20)}... (${process.env.PAYPAL_CLIENT_SECRET?.length})
=====================================
`;
    fs.writeFileSync('/tmp/vault-error-debug.log', errorLog, { flag: 'a' });

    res.status(500).json({
      success: false,
      message: 'Failed to add payment method',
      error: error.message,
      details: error.toString(),
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
// @access  Private (for testing purposes)
router.post('/payment-methods/:id/test-charge', [
  body('amount').isFloat({ min: 0.01, max: 10000 }).withMessage('Amount must be between $0.01 and $10,000')
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

  if (!tenant.subscription.status === 'active') {
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
// WEBHOOKS
// =====================================================

// @desc    PayPal webhook handler
// @route   POST /api/v1/billing/webhook/paypal
// @access  Public (but verified)
router.post('/webhook/paypal', express.raw({ type: 'application/json' }), asyncHandler(async (req, res) => {
  // PayPal IPN verification and event handling would go here
  console.log('📨 PayPal webhook received:', req.body);

  // For now, just acknowledge receipt
  res.status(200).json({ received: true });
}));

export default router;
