import Tenant from '../../models/Tenant.js';
import DID from '../../models/DID.js';
import Invoice from '../../models/Invoice.js';
import { sendInvoiceEmail, sendPaymentSuccessEmail, sendPaymentFailedEmail, sendAccountSuspendedEmail } from '../email/billingEmails.js';
import { chargePaymentToken } from './paypalCharging.js';
import {
  DIRECT_TIERS,
  FLAT_RATES,
  EARLY_ADOPTER_PROMO,
  ANNUAL_PREPAY_MONTHS_BILLED,
  ANNUAL_PREPAY_MONTHS_BILLED_ENTERPRISE,
  calculateDirectCharge,
  calculateFlatCharge,
  rateFor,
  serializeTiers
} from './pricingCurves.js';

/**
 * Resolve the tenant's effective per-DID rate.
 * Precedence: admin custom rate > active time-boxed promo > flat rate by didSource.
 */
export function getEffectiveRate(tenant) {
  const sub = tenant.subscription || {};
  const customRate = sub.perDidPricing?.customRate;
  if (customRate != null) {
    return { rate: +customRate, source: 'custom', promo: null };
  }
  const promo = sub.promo;
  if (promo?.rate != null && promo.endsAt && new Date(promo.endsAt) > new Date()) {
    return {
      rate: +promo.rate,
      source: 'promo',
      promo: { rate: +promo.rate, endsAt: promo.endsAt, label: promo.label }
    };
  }
  return { rate: rateFor(sub.didSource || 'byo', null), source: 'flat', promo: null };
}

/**
 * Grant the early-adopter promo if the tenant qualifies: BYO rate class, no
 * existing promo, and fewer than maxClients tenants already granted it.
 * Called at activation. Returns the promo granted (or null).
 */
export async function maybeGrantEarlyAdopterPromo(tenant) {
  const P = EARLY_ADOPTER_PROMO;
  const sub = tenant.subscription;
  if ((sub.didSource || 'byo') !== P.appliesTo) return null;
  if (sub.promo?.rate != null) return null; // already has one (active or expired)

  const granted = await Tenant.countDocuments({ 'subscription.promo.label': P.label });
  if (granted >= P.maxClients) return null;

  const endsAt = new Date();
  endsAt.setMonth(endsAt.getMonth() + P.months);
  sub.promo = { rate: P.rate, endsAt, label: P.label };
  console.log(`🎁 ${tenant.name}: early-adopter promo granted — $${P.rate}/DID until ${endsAt.toISOString().slice(0, 10)} (${granted + 1}/${P.maxClients})`);
  return sub.promo;
}

// Kill-switch: no real PayPal charge is attempted unless explicitly enabled.
// (Lesson from the amdy 2026-08-06 triple-charge incident.) Invoices are still
// generated and emailed when disabled, so nothing is lost — just not charged.
export function chargesEnabled() {
  return process.env.BILLING_CHARGES_ENABLED === 'true';
}

/**
 * The one true "billable DID count". Both flags must agree: customers who
 * bulk-deactivate (sets status) or whose sync deactivates (sets both) stop
 * being billed either way.
 */
export async function countBillableDids(tenantId) {
  return DID.countDocuments({ tenantId, status: 'active', isActive: true });
}

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
  const didCount = await countBillableDids(tenant._id);

  const didSource = tenant.subscription?.didSource || 'byo';
  const eff = getEffectiveRate(tenant);
  const rate = eff.rate;
  const chargeData = calculateFlatCharge(didCount, rate);

  const tierName = eff.source === 'custom'
    ? 'Custom rate'
    : eff.source === 'promo'
      ? `Early-adopter promo (until ${new Date(eff.promo.endsAt).toLocaleDateString()})`
      : (didSource === 'provided' ? 'Flat — we provide DIDs' : 'Flat — bring your own DIDs');

  const totalDidFee = chargeData.totalMonthlyCharge;
  const tax = calculateTax(totalDidFee, tenant.billing?.address);
  const subtotal = totalDidFee;
  const total = +(subtotal + tax).toFixed(2);

  return {
    didCount,
    tier: tierName,
    didSource,
    rateSource: eff.source,
    promo: eff.promo,
    baseFee: 0,
    didCharges: totalDidFee,
    tierBreakdown: chargeData.breakdown,
    totalDidFee,
    // legacy-compat fields
    includedDids: 0,
    extraDids: didCount,
    perDidRate: rate,
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

  // IDEMPOTENCY: one invoice per tenant per billing period. A cron re-fire,
  // process restart at 02:00, or admin double-trigger must never double-bill.
  const existing = await Invoice.findOne({
    tenantId: tenant._id,
    'billingPeriod.start': billingPeriodStart,
    status: { $in: ['pending', 'paid'] }
  });
  if (existing) {
    console.log(`↩️ Invoice ${existing.invoiceNumber} already exists for this period (${existing.status}) — not regenerating`);
    return existing;
  }

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
 * Activate a trial tenant after they add a payment method.
 * Charges a PRORATED amount for the remaining days of the current month
 * (rate × billable DIDs × daysRemaining/daysInMonth), then regular monthly
 * billing takes over on the 1st. Never blocks activation: if the prorated
 * amount is below $0.50 or there are no billable DIDs, activation is free.
 * Returns { activated, invoice|null, charged }.
 */
export async function activateTenantWithProratedCharge(tenant, paymentMethod) {
  const now = new Date();
  const year = now.getFullYear(), month = now.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // Include today in the paid window
  const daysRemaining = daysInMonth - now.getDate() + 1;

  // Early-adopter promo: grant BEFORE computing charges so the prorated
  // activation invoice is already at the promo rate.
  await maybeGrantEarlyAdopterPromo(tenant);

  const charges = await calculateMonthlyCharges(tenant);
  const proratedSubtotal = +(charges.totalDidFee * (daysRemaining / daysInMonth)).toFixed(2);
  const tax = +(calculateTax(proratedSubtotal, tenant.billing?.address)).toFixed(2);
  const proratedTotal = +(proratedSubtotal + tax).toFixed(2);

  // Flip to active regardless of charge size — the point of activation.
  tenant.subscription.status = 'active';
  tenant.subscription.gracePeriod.currentFailedPayments = 0;
  tenant.subscription.nextBillingDate = new Date(year, month + 1, 1);
  tenant.isActive = true;
  await tenant.save();

  if (charges.didCount === 0 || proratedTotal < 0.5) {
    console.log(`✅ ${tenant.name} activated — no prorated charge (dids=${charges.didCount}, amount=$${proratedTotal})`);
    return { activated: true, invoice: null, charged: false, amount: 0 };
  }

  // Idempotency: one activation invoice per tenant per period.
  const periodStart = now;
  const periodEnd = new Date(year, month + 1, 0);
  let invoice = await Invoice.findOne({
    tenantId: tenant._id,
    'metadata.kind': 'activation_proration',
    'billingPeriod.end': periodEnd,
    status: { $in: ['pending', 'paid'] }
  });

  if (!invoice) {
    invoice = await Invoice.create({
      tenantId: tenant._id,
      billingPeriod: { start: periodStart, end: periodEnd },
      subscription: {
        plan: tenant.subscription.plan,
        baseFee: 0,
        billingCycle: tenant.subscription.billingCycle
      },
      didCharges: {
        didCount: charges.didCount,
        includedDids: 0,
        extraDids: charges.didCount,
        perDidRate: charges.perDidRate,
        totalDidFee: proratedSubtotal
      },
      tierBreakdown: [{
        from: 1, to: charges.didCount, rate: charges.perDidRate,
        didsInTier: charges.didCount, subtotal: proratedSubtotal,
        label: `Activation — ${daysRemaining}/${daysInMonth} days of ${now.toLocaleString('en-US', { month: 'long' })} @ $${charges.perDidRate.toFixed(2)}/DID`
      }],
      amounts: { subtotal: proratedSubtotal, tax, total: proratedTotal },
      status: 'pending',
      metadata: { kind: 'activation_proration', dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) }
    });
  } else if (invoice.status === 'paid') {
    return { activated: true, invoice, charged: false, amount: 0 };
  }

  if (!chargesEnabled()) {
    console.log(`⚠️ BILLING_CHARGES_ENABLED not set — activation invoice ${invoice.invoiceNumber} created but NOT charged`);
    await sendInvoiceEmail(invoice, tenant);
    return { activated: true, invoice, charged: false, amount: proratedTotal };
  }

  try {
    // Activation is customer-initiated: the user just added this card
    await chargeInvoice(invoice, tenant, paymentMethod, { initiatedBy: 'customer', firstUse: !paymentMethod.lastUsedAt });
    return { activated: true, invoice, charged: true, amount: proratedTotal };
  } catch (err) {
    // Activation stands; the failed invoice enters the normal retry/dunning path.
    console.error(`⚠️ Activation charge failed for ${tenant.name}: ${err.message} (tenant remains active, invoice pending retry)`);
    return { activated: true, invoice, charged: false, amount: proratedTotal, chargeError: err.message };
  }
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
    if (tenant.billing.autoPayEnabled && chargesEnabled()) {
      const paymentMethod = tenant.getPrimaryPaymentMethod();

      if (paymentMethod) {
        // Skip if this period's invoice was already collected (idempotent path)
        if (invoice.status === 'paid') {
          console.log(`↩️ Invoice ${invoice.invoiceNumber} already paid — skipping charge`);
        } else {
          await chargeInvoice(invoice, tenant, paymentMethod);
        }
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
export async function chargeInvoice(invoice, tenant, paymentMethod, chargeOpts = {}) {
  console.log(`💰 Charging invoice ${invoice.invoiceNumber} using ${paymentMethod.type}...`);

  try {
    let result;

    if (paymentMethod.type === 'paypal_account') {
      result = await chargePayPalAccount(invoice, tenant);
    } else if (paymentMethod.type === 'credit_card' || paymentMethod.type === 'debit_card') {
      result = await chargeVaultedCard(paymentMethod.vaultId, invoice, {
        initiatedBy: chargeOpts.initiatedBy || 'merchant',
        firstUse: chargeOpts.firstUse ?? !paymentMethod.lastUsedAt
      });
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
async function chargeVaultedCard(vaultId, invoice, chargeOpts = {}) {
  return await chargePaymentToken(
    vaultId,
    invoice.amounts.total,
    'USD',
    `Invoice ${invoice.invoiceNumber} - ${invoice.subscription.plan} Plan`,
    {
      ...chargeOpts,
      // Stable idempotency key: PayPal rejects a duplicate invoice_id, and the
      // PayPal-Request-Id header dedupes the create call — a re-run cannot
      // double-charge even if our DB state is stale.
      invoiceId: invoice.invoiceNumber,
      customId: `didopt-invoice-${invoice.tenantId}-${invoice.invoiceNumber}`
    }
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
