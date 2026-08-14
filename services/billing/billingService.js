import Tenant from '../../models/Tenant.js';
import DID from '../../models/DID.js';
import Invoice from '../../models/Invoice.js';
import { sendInvoiceEmail, sendPaymentSuccessEmail, sendPaymentFailedEmail, sendAccountSuspendedEmail } from '../email/billingEmails.js';
import { chargePaymentToken } from './paypalCharging.js';
import {
  DIRECT_TIERS,
  ANNUAL_PREPAY_MONTHS_BILLED,
  ANNUAL_PREPAY_MONTHS_BILLED_ENTERPRISE,
  calculateDirectCharge,
  serializeTiers
} from './pricingCurves.js';

// Plan metadata. The pricing model is uniform PAYG — every tenant pays the same
// per-DID curve. `annual` is just a billing-cycle flag (12 months prepaid for the
// price of 10). `enterprise` is a quoted exception (used for hand-priced deals).
// Plan definitions tied to hybrid pricing model
export const PRICING_PLANS = {
  payg: {
    name: 'Pay-as-you-go',
    billing_cycle: 'monthly',
    pricing: 'tiered_hybrid',
    tiers: serializeTiers(DIRECT_TIERS),
    features: ['byo_dids', 'rotation', 'reputation', 'analytics', 'api_access'],
    limits: { maxUsers: 100, maxDIDs: 999999, maxConcurrentCalls: 999999, apiCallsPerMonth: 999999 }
  },
  annual: {
    name: 'Annual prepay',
    billing_cycle: 'annual',
    pricing: 'tiered_hybrid',
    tiers: serializeTiers(DIRECT_TIERS),
    monthsBilled: ANNUAL_PREPAY_MONTHS_BILLED,
    monthsBilledEnterprise: ANNUAL_PREPAY_MONTHS_BILLED_ENTERPRISE,
    features: ['all_payg', 'annual_discount'],
    limits: { maxUsers: 100, maxDIDs: 999999, maxConcurrentCalls: 999999, apiCallsPerMonth: 999999 }
  },
  enterprise: {
    name: 'Enterprise (custom)',
    billing_cycle: 'annual',
    pricing: 'custom_quoted',
    features: ['all_annual', 'custom_sla', 'white_glove', 'dedicated_support'],
    limits: { maxUsers: 999, maxDIDs: 999999, maxConcurrentCalls: 999999, apiCallsPerMonth: 999999 }
  }
};

/**
 * Calculate monthly charges for a direct tenant using hybrid pricing (base fee + per-DID).
 * Enterprise (custom-priced) tenants use customRate if set; otherwise use tier pricing.
 */
export async function calculateMonthlyCharges(tenant) {
  const didCount = await DID.countDocuments({
    tenantId: tenant._id,
    isActive: true
  });

  // Enterprise custom pricing
  const customRate = tenant.subscription?.perDidPricing?.customRate;
  const isCustom = tenant.subscription?.plan === 'enterprise' && customRate != null;

  let tierName, baseFee, didFee, breakdown, totalDidFee;

  if (isCustom) {
    tierName = 'Enterprise (custom)';
    baseFee = 0;
    didFee = +(didCount * customRate).toFixed(2);
    totalDidFee = didFee;
    breakdown = [{ from: 1, to: didCount, rate: customRate, didsInTier: didCount, subtotal: didFee }];
  } else {
    // Hybrid pricing (base fee + per-DID tiers)
    const chargeData = calculateDirectCharge(didCount);
    tierName = chargeData.tierName;
    baseFee = chargeData.baseFee;
    didFee = chargeData.didCharges;
    totalDidFee = chargeData.totalMonthlyCharge;
    breakdown = chargeData.breakdown;
  }

  const tax = calculateTax(totalDidFee, tenant.billing?.address);
  const subtotal = totalDidFee;
  const total = +(subtotal + tax).toFixed(2);

  return {
    didCount,
    tier: tierName,
    baseFee,
    didCharges: didFee,
    tierBreakdown: breakdown,
    totalDidFee,
    // legacy-compat fields
    includedDids: 0,
    extraDids: didCount,
    perDidRate: didCount > 0 ? +(didFee / didCount).toFixed(4) : 0,
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
    tierBreakdown: charges.tierBreakdown,
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
 * Charge vaulted credit card using PayPal vault token
 */
async function chargeVaultedCard(vaultId, invoice) {
  return await chargePaymentToken(
    vaultId,
    invoice.amounts.total,
    'USD',
    `Invoice ${invoice.invoiceNumber} - ${invoice.subscription.plan} Plan`
  );
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
 * Cost estimate for a given DID count + billing cycle. PAYG returns the
 * monthly charge from the stepped curve; annual prepay returns the same curve
 * × ANNUAL_PREPAY_MONTHS_BILLED (10), giving 2 months free.
 */
export function calculateEstimate(didCount, billingCycle = 'monthly') {
  const charge = calculateDirectCharge(didCount);
  const monthly = charge.total;

  if (billingCycle === 'yearly') {
    const annualTotal = +(monthly * ANNUAL_PREPAY_MONTHS_BILLED).toFixed(2);
    return {
      billingCycle: 'yearly',
      didCount,
      tierBreakdown: charge.breakdown,
      monthlyEquivalent: monthly,
      monthsBilled: ANNUAL_PREPAY_MONTHS_BILLED,
      annualTotal,
      annualSavings: +(monthly * 12 - annualTotal).toFixed(2),
      total: annualTotal
    };
  }

  return {
    billingCycle: 'monthly',
    didCount,
    tierBreakdown: charge.breakdown,
    total: monthly
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
