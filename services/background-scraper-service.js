import cron from 'node-cron';
import mongoose from 'mongoose';
import reputationService from './reputation-service.js';
import crawl4aiService from './crawl4ai-service.js';
import DID from '../models/DID.js';

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

    // Configuration
    this.config = {
      // Run every 4 hours: 0 */4 * * *
      // For testing, run every 15 minutes: */15 * * * *
      schedule: process.env.SCRAPER_SCHEDULE || '0 */4 * * *',
      batchSize: parseInt(process.env.SCRAPER_BATCH_SIZE) || 5,
      delayBetweenBatches: parseInt(process.env.SCRAPER_DELAY_MS) || 3000,
      maxConcurrentJobs: parseInt(process.env.SCRAPER_MAX_CONCURRENT) || 1,
      enabledInDevelopment: process.env.ENABLE_SCRAPER_DEV === 'true',
      maxDidsPerRun: parseInt(process.env.SCRAPER_MAX_DIDS) || 50,
      retryFailedAfterHours: parseInt(process.env.SCRAPER_RETRY_HOURS) || 24
    };

    console.log('📡 Background Scraper Service initialized with config:', this.config);
  }

  /**
   * Start the background scraper service
   */
  start() {
    if (this.isRunning) {
      console.log('⚠️ Background scraper is already running');
      return;
    }

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

      // Extract phone numbers and format for RoboKiller
      const phoneNumbers = limitedDids.map(did => this.formatPhoneNumber(did.phoneNumber));

      console.log(`🕷️ Starting Crawl4AI batch scraping for ${phoneNumbers.length} numbers`);

      // Use reputation service bulk update with Crawl4AI
      const results = await reputationService.bulkUpdateReputation(phoneNumbers, {
        batchSize: this.config.batchSize,
        delayMs: this.config.delayBetweenBatches,
        useCrawl4AI: true
      });

      // Process results
      const successful = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;

      this.stats.totalProcessed += results.length;
      this.stats.successfulScrapes += successful;
      this.stats.failedScrapes += failed;

      const processingTime = Date.now() - startTime;
      this.stats.averageProcessingTime = Math.round(
        (this.stats.averageProcessingTime + processingTime) / 2
      );

      // Log failures for monitoring
      const failures = results.filter(r => !r.success);
      if (failures.length > 0) {
        console.log(`⚠️ Failed to scrape ${failures.length} DIDs:`);
        failures.forEach(failure => {
          console.log(`   ${failure.phoneNumber}: ${failure.error}`);
          this.stats.errors.push({
            phoneNumber: failure.phoneNumber,
            error: failure.error,
            timestamp: new Date()
          });
        });

        // Keep only last 100 errors
        if (this.stats.errors.length > 100) {
          this.stats.errors = this.stats.errors.slice(-100);
        }
      }

      console.log(`✅ Scraping cycle completed in ${Math.round(processingTime / 1000)}s`);
      console.log(`📊 Results: ${successful} successful, ${failed} failed`);

      // Update proxy stats
      const proxyStats = await crawl4aiService.getProxyStats();
      console.log(`🌐 Proxy Status: ${proxyStats.healthyProxies}/${proxyStats.totalProxies} healthy`);

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
   * Get DIDs that need reputation checking
   */
  async getDIDsNeedingCheck() {
    try {
      // Get DIDs that haven't been checked recently or never checked
      const cutoffTime = new Date();
      cutoffTime.setHours(cutoffTime.getHours() - this.config.retryFailedAfterHours);

      // Find DIDs from the DID collection
      const dids = await DID.find({
        isActive: true,
        status: 'active'
      }).limit(this.config.maxDidsPerRun * 2); // Get more than we need for filtering

      if (dids.length === 0) {
        return [];
      }

      // Check which ones need reputation updates
      const DIDReputation = mongoose.model('DIDReputation');
      const phoneNumbers = dids.map(did => did.phoneNumber);

      const existingReputations = await DIDReputation.find({
        phoneNumber: { $in: phoneNumbers }
      });

      const reputationMap = new Map();
      existingReputations.forEach(rep => {
        reputationMap.set(rep.phoneNumber, rep);
      });

      // Filter DIDs that need checking
      const didsNeedingCheck = dids.filter(did => {
        const reputation = reputationMap.get(did.phoneNumber);

        if (!reputation) {
          // Never checked before
          return true;
        }

        if (reputation.isBlacklisted) {
          // Skip blacklisted DIDs
          return false;
        }

        if (!reputation.nextCheckDue) {
          // No scheduled check time, probably needs checking
          return true;
        }

        // Check if it's time for the next check
        return reputation.nextCheckDue <= new Date();
      });

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
  getStats() {
    return {
      ...this.stats,
      isRunning: this.isRunning,
      config: this.config,
      proxyService: crawl4aiService.getProxyStats()
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