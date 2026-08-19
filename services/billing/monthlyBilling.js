import cron from 'node-cron';
import Tenant from '../../models/Tenant.js';
import Invoice from '../../models/Invoice.js';
import Reseller from '../../models/Reseller.js';
import ResellerInvoice from '../../models/ResellerInvoice.js';
import DID from '../../models/DID.js';
import { processMonthlyBilling, retryPayment, chargesEnabled } from './billingService.js';
import { chargePaymentToken } from './paypalCharging.js';
import { calculateResellerCharge } from './resellerPricing.js';

/**
 * Monthly billing job
 * Runs on the 1st of every month at 2:00 AM UTC
 */
export function startMonthlyBillingJob() {
  // Run at 2 AM on the 1st of every month
  cron.schedule('0 2 1 * *', async () => {
    console.log('🔄 ===== STARTING MONTHLY BILLING CYCLE =====');
    console.log(`📅 Date: ${new Date().toISOString()}`);

    try {
      const tenants = await Tenant.find({
        isActive: true,
        'subscription.status': { $in: ['active', 'trial'] }
      });

      console.log(`📊 Found ${tenants.length} active tenants to process`);

      let successCount = 0;
      let failureCount = 0;
      let skippedCount = 0;

      for (const tenant of tenants) {
        try {
          // Check if trial ended
          if (tenant.subscription.status === 'trial' &&
              tenant.subscription.trialEndsAt < new Date()) {
            console.log(`⚠️ Trial ended for ${tenant.name}, marking as suspended`);
            tenant.subscription.status = 'suspended';
            tenant.subscription.gracePeriod.suspendedAt = new Date();
            tenant.subscription.gracePeriod.suspensionReason = 'trial_ended';
            await tenant.save();
            skippedCount++;
            continue;
          }

          // Process active subscriptions
          if (tenant.subscription.status === 'active') {
            console.log(`💳 Processing billing for: ${tenant.name}`);
            await processMonthlyBilling(tenant);
            successCount++;
            console.log(`✅ Successfully billed ${tenant.name}`);
          } else {
            skippedCount++;
          }

        } catch (error) {
          console.error(`❌ Failed to bill ${tenant.name}:`, error.message);
          failureCount++;
        }
      }

      console.log('🔄 ===== MONTHLY BILLING CYCLE COMPLETED =====');
      console.log(`✅ Success: ${successCount}`);
      console.log(`❌ Failed: ${failureCount}`);
      console.log(`⏭️  Skipped: ${skippedCount}`);

    } catch (error) {
      console.error('💥 Fatal error in monthly billing job:', error);
    }
  });

  console.log('✅ Monthly billing job scheduled (1st of month at 2:00 AM UTC)');
}

/**
 * Reseller monthly billing job.
 * For each active reseller, sums active DIDs across their client tenants and
 * creates a ResellerInvoice using the stepped per-DID pricing curve.
 */
export async function generateResellerInvoices(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  const dueDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const resellers = await Reseller.find({ status: 'active' }).lean();
  console.log(`📊 Generating invoices for ${resellers.length} active resellers`);
  const results = { generated: 0, skipped: 0, errored: 0, invoices: [] };

  for (const reseller of resellers) {
    try {
      // Idempotency: one reseller invoice per period
      const existing = await ResellerInvoice.findOne({
        resellerId: reseller._id,
        'billingPeriod.start': start,
        status: { $in: ['pending', 'paid'] }
      });
      if (existing) {
        console.log(`↩️ ResellerInvoice ${existing.invoiceNumber} already exists for ${reseller.name} — skipping`);
        results.skipped++;
        continue;
      }

      const tenants = await Tenant.find({ resellerId: reseller._id }, '_id name').lean();
      if (!tenants.length) { results.skipped++; continue; }

      const clientBreakdown = await Promise.all(tenants.map(async (t) => {
        // Same billable definition as direct tenants: both flags must agree
        const didCount = await DID.countDocuments({ tenantId: t._id, status: 'active', isActive: true });
        return { tenantId: t._id, tenantName: t.name, didCount };
      }));

      const totalDids = clientBreakdown.reduce((s, x) => s + x.didCount, 0);
      if (totalDids === 0) { results.skipped++; continue; }

      const charge = calculateResellerCharge(totalDids, reseller.customRate ?? null);
      const total = charge.totalMonthlyCharge;

      const invoice = await ResellerInvoice.create({
        resellerId: reseller._id,
        billingPeriod: { start, end },
        clientBreakdown,
        tierBreakdown: charge.breakdown,
        totalDids,
        amounts: { subtotal: total, tax: 0, total },
        status: 'pending',
        metadata: { dueDate }
      });

      results.generated++;
      results.invoices.push({ id: invoice._id, resellerId: reseller._id, total });
      console.log(`✅ ResellerInvoice ${invoice.invoiceNumber} for ${reseller.name}: $${total} (${totalDids} DIDs)`);

      // Charge the reseller's primary payment method (previously: never charged).
      if (chargesEnabled()) {
        try {
          const resellerDoc = await Reseller.findById(reseller._id);
          const pm = resellerDoc?.getPrimaryPaymentMethod?.();
          if (pm?.vaultId) {
            const chargeResult = await chargePaymentToken(
              pm.vaultId, total, 'USD',
              `Reseller invoice ${invoice.invoiceNumber} — ${totalDids} DIDs`,
              { invoiceId: invoice.invoiceNumber, customId: `didopt-reseller-${reseller._id}-${invoice.invoiceNumber}` }
            );
            await invoice.markAsPaid(chargeResult.transactionId, pm._id);
            console.log(`💰 ResellerInvoice ${invoice.invoiceNumber} charged: $${total}`);
          } else {
            console.log(`⚠️ ${reseller.name} has no payment method — invoice left pending`);
          }
        } catch (chargeErr) {
          await invoice.markAsFailed(chargeErr.message || 'Reseller charge failed');
          console.error(`❌ Reseller charge failed for ${reseller.name}: ${chargeErr.message}`);
        }
      }
    } catch (err) {
      console.error(`❌ Failed reseller invoice for ${reseller.name}:`, err.message);
      results.errored++;
    }
  }

  return results;
}

export function startResellerBillingJob() {
  // Run at 2:30 AM on the 1st of every month (after the per-tenant cron at 2:00 AM)
  cron.schedule('30 2 1 * *', async () => {
    console.log('🔄 ===== STARTING RESELLER BILLING CYCLE =====');
    try {
      const r = await generateResellerInvoices(new Date());
      console.log(`🔄 Reseller billing done — generated:${r.generated} skipped:${r.skipped} errored:${r.errored}`);
    } catch (err) {
      console.error('💥 Fatal error in reseller billing job:', err);
    }
  });
  console.log('✅ Reseller billing job scheduled (1st of month at 2:30 AM UTC)');
}

/**
 * Daily payment retry job
 * Runs every day at 3:00 AM UTC to retry failed payments
 */
export function startPaymentRetryJob() {
  // Run daily at 3 AM
  cron.schedule('0 3 * * *', async () => {
    console.log('🔄 ===== STARTING PAYMENT RETRY JOB =====');
    console.log(`📅 Date: ${new Date().toISOString()}`);

    try {
      if (!chargesEnabled()) {
        console.log('⚠️ BILLING_CHARGES_ENABLED not set — retry job skipped (no real charges)');
        return;
      }
      const failedInvoices = await Invoice.getDueForRetry();

      console.log(`📊 Found ${failedInvoices.length} invoices to retry`);

      let successCount = 0;
      let failureCount = 0;

      for (const invoice of failedInvoices) {
        // getDueForRetry already gates on: failed status, retryCount < 3, and
        // last failure >= 24h ago. markAsFailed refreshes failedAt on each
        // attempt, so retries naturally space ~daily. No extra day-gate here —
        // the old [1,3,7]-day filter combined with a 24h query window meant no
        // invoice could ever match, which silently disabled all retries.
        console.log(`🔄 Retrying payment for invoice ${invoice.invoiceNumber} (Attempt ${invoice.paymentDetails.retryCount + 1}/3)`);

        try {
          await retryPayment(invoice);
          successCount++;
          console.log(`✅ Retry successful for invoice ${invoice.invoiceNumber}`);
        } catch (error) {
          console.error(`❌ Retry failed for invoice ${invoice.invoiceNumber}:`, error.message);
          failureCount++;
          // Suspension after 3 total failures is handled in billingService
        }
      }

      console.log('🔄 ===== PAYMENT RETRY JOB COMPLETED =====');
      console.log(`✅ Success: ${successCount}`);
      console.log(`❌ Failed: ${failureCount}`);

    } catch (error) {
      console.error('💥 Fatal error in payment retry job:', error);
    }
  });

  console.log('✅ Payment retry job scheduled (daily at 3:00 AM UTC)');
}

/**
 * Usage tracking reset job (optional)
 * Resets usage counters at the start of each billing period
 */
export function startUsageResetJob() {
  // Run at midnight on the 1st of every month
  cron.schedule('0 0 1 * *', async () => {
    console.log('🔄 ===== STARTING USAGE RESET JOB =====');

    try {
      const tenants = await Tenant.find({ isActive: true });

      for (const tenant of tenants) {
        if (tenant.subscription.status === 'active') {
          const now = new Date();
          const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());

          tenant.usage.currentPeriodStart = now;
          tenant.usage.currentPeriodEnd = nextMonth;
          tenant.usage.apiCallsThisMonth = 0;
          tenant.usage.totalCallsThisMonth = 0;

          await tenant.save();
        }
      }

      console.log(`✅ Reset usage for ${tenants.length} tenants`);
      console.log('🔄 ===== USAGE RESET JOB COMPLETED =====');

    } catch (error) {
      console.error('💥 Fatal error in usage reset job:', error);
    }
  });

  console.log('✅ Usage reset job scheduled (1st of month at midnight UTC)');
}

/**
 * Start all billing jobs
 */
export function startAllBillingJobs() {
  console.log('\n🚀 ===== INITIALIZING BILLING JOBS =====\n');

  startMonthlyBillingJob();
  startResellerBillingJob();
  startPaymentRetryJob();
  startUsageResetJob();

  console.log('\n✅ ===== ALL BILLING JOBS INITIALIZED =====\n');
}

export default {
  startMonthlyBillingJob,
  startResellerBillingJob,
  generateResellerInvoices,
  startPaymentRetryJob,
  startUsageResetJob,
  startAllBillingJobs
};
