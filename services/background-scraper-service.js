import cron from 'node-cron';
import mongoose from 'mongoose';
import reputationService from './reputation-service.js';
import crawl4aiService from './crawl4ai-service.js';
import DID from '../models/DID.js';
import { enqueueReputationCheck, getQueueStatus } from './reputation-queue.js';

class BackgroundScraperService {
  constructor() {
    this.isRunning = false;
    this.currentJob = null;
    this.stats = {
      totalProcessed: 0,
      successfulScrapes: 0,
      failedScrapes: 0,
      lastRunAt: null,
      nextRunAt: null,
      averageProcessingTime: 0,
      errors: []
    };

    // Config is read lazily in start() after dotenv has loaded
    this.config = null;
  }

  /**
   * Start the background scraper service
   */
  start() {
    if (this.isRunning) {
      console.log('⚠️ Background scraper is already running');
      return;
    }

    // Read config now — dotenv is loaded by this point
    this.config = {
      schedule: process.env.SCRAPER_SCHEDULE || '*/20 * * * *',
      batchSize: parseInt(process.env.SCRAPER_BATCH_SIZE) || 20,
      delayBetweenBatches: parseInt(process.env.SCRAPER_DELAY_MS) || 500,
      maxConcurrentJobs: parseInt(process.env.SCRAPER_MAX_CONCURRENT) || 1,
      enabledInDevelopment: process.env.ENABLE_SCRAPER_DEV === 'true',
      maxDidsPerRun: parseInt(process.env.SCRAPER_MAX_DIDS) || 2000,
      retryFailedAfterHours: parseInt(process.env.SCRAPER_RETRY_HOURS) || 24
    };
    console.log('📡 Background Scraper Service config:', this.config);

    const isDevelopment = process.env.NODE_ENV === 'development';

    if (isDevelopment && !this.config.enabledInDevelopment) {
      console.log('🚫 Background scraper disabled in development mode');
      console.log('   Set ENABLE_SCRAPER_DEV=true to enable in development');
      return;
    }

    console.log(`🚀 Starting background scraper with schedule: ${this.config.schedule}`);

    this.currentJob = cron.schedule(this.config.schedule, async () => {
      await this.runScrapingCycle();
    }, {
      scheduled: true,
      timezone: 'UTC'
    });

    this.isRunning = true;
    this.updateNextRunTime();

    // Run initial scrape after 30 seconds if enabled
    if (process.env.RUN_INITIAL_SCRAPE === 'true') {
      setTimeout(() => {
        console.log('🔄 Running initial scraping cycle...');
        this.runScrapingCycle();
      }, 30000);
    }

    console.log('✅ Background scraper service started');
  }

  /**
   * Stop the background scraper service
   */
  stop() {
    if (!this.isRunning) {
      console.log('⚠️ Background scraper is not running');
      return;
    }

    if (this.currentJob) {
      this.currentJob.destroy();
      this.currentJob = null;
    }

    this.isRunning = false;
    console.log('🛑 Background scraper service stopped');
  }

  /**
   * Main scraping cycle
   */
  async runScrapingCycle() {
    if (!this.isRunning) {
      console.log('⚠️ Scraper is stopped, skipping cycle');
      return;
    }

    const startTime = Date.now();
    console.log('🔄 Starting reputation scraping cycle...');

    try {
      this.stats.lastRunAt = new Date();

      // Get DIDs that need reputation checks
      const didsToCheck = await this.getDIDsNeedingCheck();

      if (didsToCheck.length === 0) {
        console.log('✨ No DIDs need reputation checks at this time');
        this.updateNextRunTime();
        return;
      }

      console.log(`📋 Found ${didsToCheck.length} DIDs needing reputation checks`);

      // Limit to maxDidsPerRun to avoid overloading
      const limitedDids = didsToCheck.slice(0, this.config.maxDidsPerRun);
      if (limitedDids.length < didsToCheck.length) {
        console.log(`⚡ Limited to ${limitedDids.length} DIDs for this run (max: ${this.config.maxDidsPerRun})`);
      }

      // Extract phone numbers and push to the queue (workers do the scraping)
      const phoneNumbers = limitedDids.map(did => this.formatPhoneNumber(did.phoneNumber));
      await enqueueReputationCheck(phoneNumbers, 'normal');

      this.stats.totalProcessed += phoneNumbers.length;
      const processingTime = Date.now() - startTime;
      this.stats.averageProcessingTime = Math.round(
        (this.stats.averageProcessingTime + processingTime) / 2
      );

      const queueStatus = await getQueueStatus();
      console.log(`✅ Enqueued ${phoneNumbers.length} DIDs in ${Date.now() - startTime}ms — queue: waiting=${queueStatus.waiting} active=${queueStatus.active}`);

    } catch (error) {
      console.error('❌ Error in scraping cycle:', error);
      this.stats.errors.push({
        error: `Cycle error: ${error.message}`,
        timestamp: new Date()
      });
    } finally {
      this.updateNextRunTime();
    }
  }

  /**
   * Get DIDs that need reputation checking.
   * Priority: never-checked DIDs first, then oldest-checked. This keeps
   * new DIDs from getting starved when the active-DID count exceeds
   * maxDidsPerRun.
   */
  async getDIDsNeedingCheck() {
    try {
      const DIDReputation = mongoose.model('DIDReputation');

      // Build a blacklist set in one projection query. Used to filter the
      // DID candidates in-memory — can't push this into the DID query because
      // phone formats differ (10-digit DIDReputation vs "1..." / "+1..." DID).
      const blacklisted = await DIDReputation.find(
        { isBlacklisted: true },
        { phoneNumber: 1, _id: 0 }
      ).lean();
      const blacklistedSet = new Set(blacklisted.map(r => r.phoneNumber));

      // Only scrape DIDs owned by PAYING tenants (subscription.status === 'active').
      // Trial / suspended / cancelled tenants are excluded so we don't burn proxy
      // and scraping budget on accounts that haven't paid.
      const Tenant = mongoose.model('Tenant');
      const paidTenants = await Tenant.find(
        { 'subscription.status': 'active' },
        { _id: 1 }
      ).lean();
      const paidTenantIds = paidTenants.map(t => t._id);
      if (paidTenantIds.length === 0) {
        console.log('💤 No paying tenants — skipping reputation scrape cycle');
        return [];
      }

      // Pull a much larger candidate pool so when we skip blacklisted zombies
      // we still have enough non-blacklisted DIDs left to fill the batch.
      const poolSize = Math.max(this.config.maxDidsPerRun * 10, 1000);
      const dids = await DID.find({ isActive: true, status: 'active', tenantId: { $in: paidTenantIds } })
        .sort({ 'reputation.lastChecked': 1 })
        .limit(poolSize);

      if (dids.length === 0) return [];

      const normalizedPhones = dids
        .map(did => this.formatPhoneNumber(did.phoneNumber))
        .filter(p => !blacklistedSet.has(p));

      const existingReputations = await DIDReputation.find({
        phoneNumber: { $in: normalizedPhones }
      });
      const reputationMap = new Map();
      existingReputations.forEach(rep => {
        reputationMap.set(this.formatPhoneNumber(rep.phoneNumber), rep);
      });

      const didsNeedingCheck = [];
      for (const did of dids) {
        const phone = this.formatPhoneNumber(did.phoneNumber);
        const reputation = reputationMap.get(phone);

        // For BLACKLISTED DIDs: re-check only if nextCheckDue is in the past
        // (defaults to 7 days). This lets recovered DIDs get unblacklisted
        // while preventing constant rechecks of known-bad numbers.
        // For NON-BLACKLISTED: original logic — refresh when due or missing.
        const hasFreshDue = reputation && reputation.nextCheckDue
                          && reputation.nextCheckDue > new Date();
        if (hasFreshDue) continue;

        // If blacklisted with no nextCheckDue at all (legacy data), schedule
        // it for re-check now (we want to know if it has recovered).
        didsNeedingCheck.push(did);
        if (didsNeedingCheck.length >= this.config.maxDidsPerRun) break;
      }
      return didsNeedingCheck;

    } catch (error) {
      console.error('Error getting DIDs needing check:', error);
      return [];
    }
  }

  /**
   * Format phone number for RoboKiller (remove +1 and non-digits)
   */
  formatPhoneNumber(phoneNumber) {
    // Remove all non-digits
    let cleaned = phoneNumber.replace(/\D/g, '');

    // Remove leading +1 if present
    if (cleaned.startsWith('1') && cleaned.length === 11) {
      cleaned = cleaned.substring(1);
    }

    return cleaned;
  }

  /**
   * Update next run time for monitoring
   */
  updateNextRunTime() {
    if (this.currentJob) {
      // Calculate next run time based on cron schedule
      // This is a simplified calculation
      const now = new Date();
      if (this.config.schedule === '0 */4 * * *') {
        // Every 4 hours
        const nextHour = Math.ceil(now.getHours() / 4) * 4;
        this.stats.nextRunAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), nextHour, 0, 0);
        if (this.stats.nextRunAt <= now) {
          this.stats.nextRunAt.setHours(this.stats.nextRunAt.getHours() + 4);
        }
      } else if (this.config.schedule === '*/15 * * * *') {
        // Every 15 minutes
        const nextMinute = Math.ceil(now.getMinutes() / 15) * 15;
        this.stats.nextRunAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), nextMinute, 0);
        if (this.stats.nextRunAt <= now) {
          this.stats.nextRunAt.setHours(this.stats.nextRunAt.getHours() + 1);
          this.stats.nextRunAt.setMinutes(0);
        }
      } else {
        // Default: next hour
        this.stats.nextRunAt = new Date(now.getTime() + 60 * 60 * 1000);
      }
    }
  }

  /**
   * Get service statistics
   */
  async getStats() {
    return {
      ...this.stats,
      isRunning: this.isRunning,
      config: this.config,
      proxyService: await crawl4aiService.getProxyStats()
    };
  }

  /**
   * Manually trigger a scraping cycle (for testing/admin)
   */
  async triggerManualScrape(maxDids = 10) {
    if (!this.isRunning) {
      throw new Error('Background scraper service is not running');
    }

    console.log(`🔄 Manual scrape triggered (max ${maxDids} DIDs)`);

    const originalMaxDids = this.config.maxDidsPerRun;
    this.config.maxDidsPerRun = maxDids;

    try {
      await this.runScrapingCycle();
      return this.getStats();
    } finally {
      this.config.maxDidsPerRun = originalMaxDids;
    }
  }

  /**
   * Get health status
   */
  async getHealth() {
    const crawl4aiHealth = await crawl4aiService.healthCheck();

    return {
      service: 'background-scraper',
      status: this.isRunning ? 'running' : 'stopped',
      lastRun: this.stats.lastRunAt,
      nextRun: this.stats.nextRunAt,
      totalProcessed: this.stats.totalProcessed,
      successRate: this.stats.totalProcessed > 0
        ? Math.round((this.stats.successfulScrapes / this.stats.totalProcessed) * 100)
        : 0,
      crawl4aiService: crawl4aiHealth,
      recentErrors: this.stats.errors.slice(-5),
      config: {
        schedule: this.config.schedule,
        batchSize: this.config.batchSize,
        maxDidsPerRun: this.config.maxDidsPerRun
      }
    };
  }
}

// Export singleton instance
export default new BackgroundScraperService();