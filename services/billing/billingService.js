import paypal from 'paypal-rest-sdk';
import Tenant from '../../models/Tenant.js';
import DID from '../../models/DID.js';
import Invoice from '../../models/Invoice.js';
import { sendInvoiceEmail, sendPaymentSuccessEmail, sendPaymentFailedEmail, sendAccountSuspendedEmail } from '../email/billingEmails.js';

// Pricing plans configuration
export const PRICING_PLANS = {
  basic: {
    name: 'Basic',
    price: 99,
    includedDids: 250,
    perDidCost: 1.50,
    features: ['byo_dids', 'basic_rotation', 'geo_recommendations', 'auto_purchase'],
    limits: { maxUsers: 5, maxDIDs: 250, maxConcurrentCalls: 10, apiCallsPerMonth: 10000 }
  },
  professional: {
    name: 'Professional',
    price: 299,
    includedDids: 1000,
    perDidCost: 1.00,
    features: ['all_basic', 'ai_rotation', 'predictive_analytics', 'advanced_algorithms'],
    limits: { maxUsers: 25, maxDIDs: 1000, maxConcurrentCalls: 100, apiCallsPerMonth: 100000 }
  },
  enterprise: {
    name: 'Enterprise',
    price: 'custom',
    includedDids: 999999,
    perDidCost: 'custom',
    features: ['all_professional', 'custom_ml', 'unlimited_dids', 'white_glove'],
    limits: { maxUsers: 100, maxDIDs: 999999, maxConcurrentCalls: 999999, apiCallsPerMonth: 999999 }
  }
};

/**
 * Calculate monthly charges for a tenant
 */
export async function calculateMonthlyCharges(tenant) {
  const plan = PRICING_PLANS[tenant.subscription.plan];

  if (!plan || plan.price === 'custom') {
    throw new Error('Cannot calculate charges for custom plan');
  }

  // Count active DIDs
  const didCount = await DID.countDocuments({
    tenantId: tenant._id,
    isActive: true
  });

  // Calculate base fee
  const baseFee = plan.price;

  // Calculate per-DID charges
  const includedDids = tenant.subscription.perDidPricing.customRate !== null
    ? plan.includedDids // Use standard for enterprise with custom rate
    : plan.includedDids;

  const extraDids = Math.max(0, didCount - includedDids);

  const perDidRate = tenant.subscription.perDidPricing.customRate !== null
    ? tenant.subscription.perDidPricing.customRate
    : plan.perDidCost;

  const totalDidFee = extraDids * perDidRate;

  // Calculate subtotal
  const subtotal = baseFee + totalDidFee;

  // Calculate tax (simplified - you may want to integrate with a tax service)
  const tax = calculateTax(subtotal, tenant.billing.address);

  // Calculate total
  const total = subtotal + tax;

  return {
    baseFee,
    didCount,
    includedDids,
    extraDids,
    perDidRate,
    totalDidFee,
    subtotal,
    tax,
    total
  };
}

/**
 * Calculate tax based on address (simplified)
 */
function calculateTax(amount, address) {
  // Simplified tax calculation
  // In production, integrate with a tax service like TaxJar or Avalara
  if (!address || !address.state) return 0;

  // Example: Simple state tax rates
  const stateTaxRates = {
    'CA': 0.0725, // California
    'NY': 0.04,   // New York
    'TX': 0.0625, // Texas
    // Add more states as needed
  };

  const taxRate = stateTaxRates[address.state] || 0;
  return amount * taxRate;
}

/**
 * Generate invoice for tenant
 */
export async function generateInvoice(tenant) {
  console.log(`📄 Generating invoice for ${tenant.name}...`);

  const charges = await calculateMonthlyCharges(tenant);

  // Create billing period
  const now = new Date();
  const billingPeriodStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const billingPeriodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  // Create invoice
  const invoice = await Invoice.create({
    tenantId: tenant._id,
    billingPeriod: {
      start: billingPeriodStart,
      end: billingPeriodEnd
    },
    subscription: {
      plan: tenant.subscription.plan,
      baseFee: charges.baseFee,
      billingCycle: tenant.subscription.billingCycle
    },
    didCharges: {
      didCount: charges.didCount,
      includedDids: charges.includedDids,
      extraDids: charges.extraDids,
      perDidRate: charges.perDidRate,
      totalDidFee: charges.totalDidFee
    },
    amounts: {
      subtotal: charges.subtotal,
      tax: charges.tax,
      total: charges.total
    },
    status: 'pending',
    metadata: {
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days from now
    }
  });

  console.log(`✅ Invoice ${invoice.invoiceNumber} generated: $${charges.total.toFixed(2)}`);

  return invoice;
}

/**
 * Process monthly billing for a tenant
 */
export async function processMonthlyBilling(tenant) {
  console.log(`💳 Processing monthly billing for ${tenant.name}...`);

  try {
    // Generate invoice
    const invoice = await generateInvoice(tenant);

    // Attempt to charge if auto-pay is enabled
    if (tenant.billing.autoPayEnabled) {
      const paymentMethod = tenant.getPrimaryPaymentMethod();

      if (paymentMethod) {
        await chargeInvoice(invoice, tenant, paymentMethod);
      } else {
        console.log(`⚠️ No payment method found for ${tenant.name}, sending invoice email`);
        await sendInvoiceEmail(invoice, tenant);
      }
    } else {
      // Just send invoice email
      await sendInvoiceEmail(invoice, tenant);
    }

    // Update tenant billing info
    tenant.billing.lastInvoiceDate = new Date();
    await tenant.save();

    return invoice;
  } catch (error) {
    console.error(`❌ Failed to process billing for ${tenant.name}:`, error);
    throw error;
  }
}

/**
 * Charge invoice using payment method
 */
export async function chargeInvoice(invoice, tenant, paymentMethod) {
  console.log(`💰 Charging invoice ${invoice.invoiceNumber} using ${paymentMethod.type}...`);

  try {
    let result;

    if (paymentMethod.type === 'paypal_account') {
      result = await chargePayPalAccount(invoice, tenant);
    } else if (paymentMethod.type === 'credit_card' || paymentMethod.type === 'debit_card') {
      result = await chargeVaultedCard(paymentMethod.vaultId, invoice);
    } else {
      throw new Error(`Unsupported payment method type: ${paymentMethod.type}`);
    }

    // Mark invoice as paid
    await invoice.markAsPaid(result.transactionId, paymentMethod._id);

    // Update payment method last used
    paymentMethod.lastUsedAt = new Date();
    await tenant.save();

    // Update tenant billing totals
    tenant.billing.totalPaid += invoice.amounts.total;
    tenant.billing.totalOutstanding = Math.max(0, tenant.billing.totalOutstanding - invoice.amounts.total);

    // Reset failed payment counter on success
    tenant.subscription.gracePeriod.currentFailedPayments = 0;
    await tenant.save();

    // Send success email
    await sendPaymentSuccessEmail(invoice, tenant);

    console.log(`✅ Invoice ${invoice.invoiceNumber} paid successfully`);

    return result;
  } catch (error) {
    console.error(`❌ Payment failed for invoice ${invoice.invoiceNumber}:`, error);

    // Mark invoice as failed
    await invoice.markAsFailed(error.message || 'Payment processing failed');

    // Handle billing failure
    await handleBillingFailure(tenant, error);

    throw error;
  }
}

/**
 * Charge PayPal account (for subscription)
 */
async function chargePayPalAccount(invoice, tenant) {
  // This would use PayPal subscription billing
  // For now, we'll implement the one-time payment approach
  throw new Error('PayPal subscription charging not yet implemented');
}

/**
 * Charge vaulted credit card
 */
async function chargeVaultedCard(vaultId, invoice) {
  const paymentData = {
    intent: 'sale',
    payer: {
      payment_method: 'credit_card',
      funding_instruments: [{
        credit_card_token: {
          credit_card_id: vaultId
        }
      }]
    },
    transactions: [{
      amount: {
        total: invoice.amounts.total.toFixed(2),
        currency: 'USD',
        details: {
          subtotal: invoice.amounts.subtotal.toFixed(2),
          tax: invoice.amounts.tax.toFixed(2)
        }
      },
      description: `Invoice ${invoice.invoiceNumber} - ${invoice.subscription.plan} Plan`,
      invoice_number: invoice.invoiceNumber,
      custom: invoice.tenantId.toString()
    }]
  };

  return new Promise((resolve, reject) => {
    paypal.payment.create(paymentData, (error, payment) => {
      if (error) {
        reject(error);
      } else {
        // Payment successful
        const sale = payment.transactions[0].related_resources[0].sale;
        resolve({
          transactionId: sale.id,
          status: sale.state,
          amount: sale.amount.total
        });
      }
    });
  });
}

/**
 * Handle billing failure
 */
export async function handleBillingFailure(tenant, error) {
  tenant.subscription.gracePeriod.currentFailedPayments += 1;

  if (tenant.subscription.gracePeriod.currentFailedPayments >= 3) {
    // Suspend account after 3 failures
    await suspendAccount(tenant, 'payment_failed');
  } else {
    // Send payment failed email with retry info
    await sendPaymentFailedEmail(tenant, {
      attemptsRemaining: 3 - tenant.subscription.gracePeriod.currentFailedPayments,
      gracePeriodEnds: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      error: error.message
    });
  }

  await tenant.save();
}

/**
 * Suspend account
 */
export async function suspendAccount(tenant, reason) {
  console.log(`🚫 Suspending account: ${tenant.name} (Reason: ${reason})`);

  tenant.subscription.status = 'suspended';
  tenant.subscription.gracePeriod.suspendedAt = new Date();
  tenant.subscription.gracePeriod.suspensionReason = reason;
  tenant.isActive = false;

  await tenant.save();

  // Send suspension email
  await sendAccountSuspendedEmail(tenant);

  console.log(`✅ Account ${tenant.name} suspended`);
}

/**
 * Retry failed payment
 */
export async function retryPayment(invoice) {
  console.log(`🔄 Retrying payment for invoice ${invoice.invoiceNumber}...`);

  if (!invoice.canRetry()) {
    throw new Error('Invoice cannot be retried (max attempts reached)');
  }

  const tenant = await Tenant.findById(invoice.tenantId);
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  const paymentMethod = tenant.getPrimaryPaymentMethod();
  if (!paymentMethod) {
    throw new Error('No payment method found');
  }

  return await chargeInvoice(invoice, tenant, paymentMethod);
}

/**
 * Calculate estimated cost for a plan with specific DID count
 */
export function calculateEstimate(plan, didCount, billingCycle = 'monthly', customRate = null) {
  const planConfig = PRICING_PLANS[plan];

  if (!planConfig || planConfig.price === 'custom') {
    throw new Error('Cannot calculate estimate for custom plan');
  }

  const baseFee = billingCycle === 'yearly'
    ? planConfig.price * 10 // 2 months free
    : planConfig.price;

  const includedDids = planConfig.includedDids;
  const extraDids = Math.max(0, didCount - includedDids);
  const perDidRate = customRate || planConfig.perDidCost;
  const totalDidFee = extraDids * perDidRate;

  const subtotal = baseFee + totalDidFee;
  const tax = 0; // Simplified for estimate
  const total = subtotal + tax;

  return {
    plan,
    billingCycle,
    baseFee,
    didCount,
    includedDids,
    extraDids,
    perDidRate,
    totalDidFee,
    subtotal,
    tax,
    total
  };
}

export default {
  PRICING_PLANS,
  calculateMonthlyCharges,
  generateInvoice,
  processMonthlyBilling,
  chargeInvoice,
  handleBillingFailure,
  suspendAccount,
  retryPayment,
  calculateEstimate
};
