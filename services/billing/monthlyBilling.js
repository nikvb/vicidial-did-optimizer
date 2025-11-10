import cron from 'node-cron';
import Tenant from '../../models/Tenant.js';
import Invoice from '../../models/Invoice.js';
import { processMonthlyBilling, retryPayment } from './billingService.js';

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
 * Daily payment retry job
 * Runs every day at 3:00 AM UTC to retry failed payments
 */
export function startPaymentRetryJob() {
  // Run daily at 3 AM
  cron.schedule('0 3 * * *', async () => {
    console.log('🔄 ===== STARTING PAYMENT RETRY JOB =====');
    console.log(`📅 Date: ${new Date().toISOString()}`);

    try {
      const failedInvoices = await Invoice.getDueForRetry();

      console.log(`📊 Found ${failedInvoices.length} invoices to retry`);

      let successCount = 0;
      let failureCount = 0;

      for (const invoice of failedInvoices) {
        const tenant = invoice.tenantId;
        const daysSinceFailed = Math.floor(
          (Date.now() - invoice.paymentDetails.failedAt) / (24 * 60 * 60 * 1000)
        );

        // Retry logic: Day 1, 3, 7
        if ([1, 3, 7].includes(daysSinceFailed)) {
          console.log(`🔄 Retrying payment for invoice ${invoice.invoiceNumber} (Attempt ${invoice.paymentDetails.retryCount + 1}/3)`);

          try {
            await retryPayment(invoice);
            successCount++;
            console.log(`✅ Retry successful for invoice ${invoice.invoiceNumber}`);
          } catch (error) {
            console.error(`❌ Retry failed for invoice ${invoice.invoiceNumber}:`, error.message);
            failureCount++;

            // Suspend after 3 failed attempts (handled in retryPayment/billingService)
          }
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
  startPaymentRetryJob();
  startUsageResetJob();

  console.log('\n✅ ===== ALL BILLING JOBS INITIALIZED =====\n');
}

export default {
  startMonthlyBillingJob,
  startPaymentRetryJob,
  startUsageResetJob,
  startAllBillingJobs
};
