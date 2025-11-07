import axios from 'axios';
import * as cheerio from 'cheerio';
import mongoose from 'mongoose';
import crawl4aiService from './crawl4ai-service.js';

// DID Reputation Schema
const DIDReputationSchema = new mongoose.Schema({
  phoneNumber: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  robokillerData: {
    userReports: { type: Number, default: 0 },
    reputationStatus: {
      type: String,
      enum: ['Positive', 'Negative', 'Neutral', 'Unknown'],
      default: 'Unknown'
    },
    totalCalls: { type: Number, default: 0 },
    lastCallDate: { type: String },
    robokillerStatus: {
      type: String,
      enum: ['Allowed', 'Blocked', 'Unknown'],
      default: 'Unknown'
    },
    spamScore: { type: Number, min: 0, max: 100 },
    callerName: { type: String },
    location: { type: String },
    carrier: { type: String }
  },
  reputationScore: {
    type: Number,
    min: 0,
    max: 100,
    default: 50
  },
  lastChecked: { type: Date, default: Date.now },
  nextCheckDue: { type: Date },
  checkCount: { type: Number, default: 0 },
  isBlacklisted: { type: Boolean, default: false },
  blacklistedAt: { type: Date },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Add indexes for efficient querying
DIDReputationSchema.index({ reputationScore: 1 });
DIDReputationSchema.index({ 'robokillerData.reputationStatus': 1 });
DIDReputationSchema.index({ lastChecked: 1 });
DIDReputationSchema.index({ nextCheckDue: 1 });
DIDReputationSchema.index({ isBlacklisted: 1 });

const DIDReputation = mongoose.model('DIDReputation', DIDReputationSchema);

/**
 * Service for managing DID reputation data
 */
class ReputationService {
  constructor() {
    this.checkInterval = {
      positive: 7 * 24 * 60 * 60 * 1000,  // 7 days for positive reputation
      neutral: 3 * 24 * 60 * 60 * 1000,   // 3 days for neutral
      negative: null                       // Never check negative DIDs again (blacklisted)
    };
  }

  /**
   * Calculate reputation score based on RoboKiller data
   */
  calculateReputationScore(robokillerData) {
    let score = 50; // Start with neutral score

    // Adjust based on reputation status
    if (robokillerData.reputationStatus === 'Positive') {
      score += 30;
    } else if (robokillerData.reputationStatus === 'Negative') {
      score -= 30;
    }

    // Adjust based on user reports (negative impact)
    if (robokillerData.userReports > 0) {
      score -= Math.min(robokillerData.userReports * 2, 20);
    }

    // Adjust based on RoboKiller status
    if (robokillerData.robokillerStatus === 'Blocked') {
      score -= 20;
    } else if (robokillerData.robokillerStatus === 'Allowed') {
      score += 10;
    }

    // Adjust based on spam score if available
    if (robokillerData.spamScore !== undefined) {
      score -= robokillerData.spamScore / 5; // Max -20 for 100% spam score
    }

    // Ensure score is within bounds
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  /**
   * Fetch reputation data from RoboKiller using Crawl4AI
   */
  async fetchRoboKillerData(phoneNumber) {
    const cleanNumber = phoneNumber.replace(/\D/g, '');

    try {
      console.log(`🕷️ Using Crawl4AI to fetch reputation data for ${cleanNumber}`);
      const result = await crawl4aiService.scrapeRoboKillerData(cleanNumber);

      if (!result.success) {
        console.warn(`⚠️ Crawl4AI failed for ${phoneNumber}, falling back to axios:`, result.error);
        return await this.fetchRoboKillerDataFallback(phoneNumber);
      }

      const data = result.data;
      console.log(`✅ Crawl4AI success for ${phoneNumber} (method: ${result.method})`);

      // Ensure all required fields are present with defaults
      return {
        userReports: data.userReports || 0,
        reputationStatus: data.reputationStatus || 'Unknown',
        totalCalls: data.totalCalls || 0,
        lastCallDate: data.lastCallDate || null,
        robokillerStatus: data.robokillerStatus || 'Unknown',
        spamScore: data.spamScore || null,
        callerName: data.callerName || null,
        location: data.location || null,
        carrier: data.carrier || null
      };
    } catch (error) {
      console.error(`❌ Crawl4AI error for ${phoneNumber}:`, error.message);
      console.log(`🔄 Falling back to axios for ${phoneNumber}`);
      return await this.fetchRoboKillerDataFallback(phoneNumber);
    }
  }

  /**
   * Fallback method using axios and cheerio
   */
  async fetchRoboKillerDataFallback(phoneNumber) {
    const cleanNumber = phoneNumber.replace(/\D/g, '');
    const url = `https://lookup.robokiller.com/search?q=${cleanNumber}`;

    try {
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        timeout: 10000
      });

      const $ = cheerio.load(response.data);
      const data = {
        userReports: 0,
        reputationStatus: 'Unknown',
        totalCalls: 0,
        lastCallDate: null,
        robokillerStatus: 'Unknown'
      };

      // Extract reputation status
      const reputationElem = $('.reputation-value, .reputation-status span').first();
      if (reputationElem.length) {
        const status = reputationElem.text().trim();
        if (status.toLowerCase().includes('positive')) {
          data.reputationStatus = 'Positive';
        } else if (status.toLowerCase().includes('negative')) {
          data.reputationStatus = 'Negative';
        } else if (status.toLowerCase().includes('neutral')) {
          data.reputationStatus = 'Neutral';
        }
      }

      // Extract RoboKiller status
      const statusElem = $('.status-value, .robokiller-status span').first();
      if (statusElem.length) {
        const status = statusElem.text().trim();
        if (status.toLowerCase().includes('allowed')) {
          data.robokillerStatus = 'Allowed';
        } else if (status.toLowerCase().includes('blocked')) {
          data.robokillerStatus = 'Blocked';
        }
      }

      // Extract user reports
      const reportsElem = $('.reports-count, .user-reports-data p').first();
      if (reportsElem.length) {
        const match = reportsElem.text().match(/\d+/);
        if (match) {
          data.userReports = parseInt(match[0]);
        }
      }

      // Extract total calls
      const callsElem = $('.calls-count, .total-calls-data p').first();
      if (callsElem.length) {
        const match = callsElem.text().match(/\d+/);
        if (match) {
          data.totalCalls = parseInt(match[0]);
        }
      }

      // Extract last call date
      const dateElem = $('.last-call-date, .last-call-data p').first();
      if (dateElem.length) {
        data.lastCallDate = dateElem.text().trim();
      }

      return data;
    } catch (error) {
      console.error(`Error in fallback fetch for ${phoneNumber}:`, error.message);
      throw error;
    }
  }

  /**
   * Get or update reputation data for a DID
   */
  async getReputation(phoneNumber, forceRefresh = false) {
    try {
      // Check if we have cached data
      let reputation = await DIDReputation.findOne({ phoneNumber });

      // Determine if we need to refresh
      const shouldRefresh = forceRefresh ||
                          !reputation ||
                          (reputation.nextCheckDue && reputation.nextCheckDue <= new Date());

      if (shouldRefresh) {
        console.log(`🔄 Fetching fresh reputation data for ${phoneNumber}`);

        // Fetch new data from RoboKiller
        const robokillerData = await this.fetchRoboKillerData(phoneNumber);

        // Calculate reputation score
        const reputationScore = this.calculateReputationScore(robokillerData);

        // Determine next check interval
        let nextCheckDue = null;
        const status = robokillerData.reputationStatus.toLowerCase();

        let isBlacklisted = false;
        let blacklistedAt = null;

        if (status === 'negative') {
          // Negative DIDs are blacklisted - never check again
          nextCheckDue = null;
          isBlacklisted = true;
          blacklistedAt = new Date();
          console.log(`🚫 Blacklisting negative DID: ${phoneNumber}`);
        } else {
          const checkInterval = this.checkInterval[status] || this.checkInterval.neutral;
          nextCheckDue = new Date(Date.now() + checkInterval);
        }

        if (reputation) {
          // Update existing record
          reputation.robokillerData = robokillerData;
          reputation.reputationScore = reputationScore;
          reputation.lastChecked = new Date();
          reputation.nextCheckDue = nextCheckDue;
          reputation.checkCount++;
          reputation.isBlacklisted = isBlacklisted;
          if (blacklistedAt) reputation.blacklistedAt = blacklistedAt;
          reputation.updatedAt = new Date();
          await reputation.save();
        } else {
          // Create new record
          reputation = await DIDReputation.create({
            phoneNumber,
            robokillerData,
            reputationScore,
            nextCheckDue,
            isBlacklisted,
            blacklistedAt,
            checkCount: 1
          });
        }
      }

      return reputation;
    } catch (error) {
      console.error(`Error getting reputation for ${phoneNumber}:`, error);

      // Return cached data if available, even if stale
      const cachedReputation = await DIDReputation.findOne({ phoneNumber });
      if (cachedReputation) {
        console.log(`⚠️ Returning cached reputation data for ${phoneNumber}`);
        return cachedReputation;
      }

      // Return default reputation if no cached data
      return {
        phoneNumber,
        robokillerData: {
          reputationStatus: 'Unknown',
          robokillerStatus: 'Unknown',
          userReports: 0,
          totalCalls: 0
        },
        reputationScore: 50,
        lastChecked: null,
        error: error.message
      };
    }
  }

  /**
   * Bulk update reputation for multiple DIDs using Crawl4AI batch processing
   */
  async bulkUpdateReputation(phoneNumbers, options = {}) {
    const { batchSize = 3, delayMs = 2000, useCrawl4AI = true } = options;

    if (useCrawl4AI) {
      console.log(`🕷️ Using Crawl4AI batch processing for ${phoneNumbers.length} DIDs`);

      try {
        // Use Crawl4AI's optimized batch scraping
        const scrapeResults = await crawl4aiService.batchScrape(phoneNumbers, {
          batchSize,
          delayMs,
          maxRetries: 2
        });

        // Process scraped data and update database
        const results = [];
        for (const scrapeResult of scrapeResults) {
          try {
            if (scrapeResult.success && scrapeResult.data.success) {
              // Update reputation data in database
              const robokillerData = scrapeResult.data.data;
              const reputationScore = this.calculateReputationScore(robokillerData);

              // Determine next check interval
              let nextCheckDue = null;
              const status = robokillerData.reputationStatus.toLowerCase();
              let isBlacklisted = false;
              let blacklistedAt = null;

              if (status === 'negative') {
                isBlacklisted = true;
                blacklistedAt = new Date();
                console.log(`🚫 Blacklisting negative DID: ${scrapeResult.phoneNumber}`);
              } else {
                const checkInterval = this.checkInterval[status] || this.checkInterval.neutral;
                nextCheckDue = new Date(Date.now() + checkInterval);
              }

              // Update or create reputation record
              const reputation = await DIDReputation.findOneAndUpdate(
                { phoneNumber: scrapeResult.phoneNumber },
                {
                  robokillerData,
                  reputationScore,
                  lastChecked: new Date(),
                  nextCheckDue,
                  isBlacklisted,
                  blacklistedAt,
                  updatedAt: new Date(),
                  $inc: { checkCount: 1 }
                },
                { upsert: true, new: true }
              );

              results.push({
                phoneNumber: scrapeResult.phoneNumber,
                success: true,
                data: reputation,
                method: 'crawl4ai'
              });

            } else {
              // Handle scraping failure
              results.push({
                phoneNumber: scrapeResult.phoneNumber,
                success: false,
                error: scrapeResult.error || 'Scraping failed',
                method: 'crawl4ai'
              });
            }
          } catch (dbError) {
            console.error(`Database error for ${scrapeResult.phoneNumber}:`, dbError);
            results.push({
              phoneNumber: scrapeResult.phoneNumber,
              success: false,
              error: `Database error: ${dbError.message}`,
              method: 'crawl4ai'
            });
          }
        }

        return results;

      } catch (error) {
        console.error('Crawl4AI batch processing failed, falling back to legacy method:', error);
        return await this.bulkUpdateReputationLegacy(phoneNumbers, options);
      }
    } else {
      return await this.bulkUpdateReputationLegacy(phoneNumbers, options);
    }
  }

  /**
   * Legacy bulk update method (fallback)
   */
  async bulkUpdateReputationLegacy(phoneNumbers, options = {}) {
    const { batchSize = 5, delayMs = 2000 } = options;
    const results = [];

    for (let i = 0; i < phoneNumbers.length; i += batchSize) {
      const batch = phoneNumbers.slice(i, i + batchSize);

      const batchPromises = batch.map(phoneNumber =>
        this.getReputation(phoneNumber, true)
          .then(result => ({ phoneNumber, success: true, data: result, method: 'legacy' }))
          .catch(error => ({ phoneNumber, success: false, error: error.message, method: 'legacy' }))
      );

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);

      // Add delay between batches to avoid rate limiting
      if (i + batchSize < phoneNumbers.length) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    return results;
  }

  /**
   * Get DIDs by reputation status
   */
  async getDIDsByReputation(status, limit = 100) {
    return await DIDReputation.find({
      'robokillerData.reputationStatus': status
    })
    .limit(limit)
    .sort({ reputationScore: -1 });
  }

  /**
   * Get top performing DIDs
   */
  async getTopDIDs(limit = 20) {
    return await DIDReputation.find({
      reputationScore: { $gte: 70 },
      'robokillerData.robokillerStatus': 'Allowed'
    })
    .limit(limit)
    .sort({ reputationScore: -1, lastChecked: -1 });
  }

  /**
   * Get DIDs that need reputation check (excluding blacklisted ones)
   */
  async getDIDsNeedingCheck(limit = 50) {
    return await DIDReputation.find({
      isBlacklisted: { $ne: true },  // Exclude blacklisted DIDs
      $or: [
        { nextCheckDue: { $lte: new Date() } },
        { lastChecked: null }
      ]
    })
    .limit(limit)
    .sort({ nextCheckDue: 1 });
  }

  /**
   * Generate reputation report
   */
  async generateReputationReport() {
    const [totalDIDs, positiveDIDs, negativeDIDs, blockedDIDs, blacklistedDIDs, needsCheck] = await Promise.all([
      DIDReputation.countDocuments(),
      DIDReputation.countDocuments({ 'robokillerData.reputationStatus': 'Positive' }),
      DIDReputation.countDocuments({ 'robokillerData.reputationStatus': 'Negative' }),
      DIDReputation.countDocuments({ 'robokillerData.robokillerStatus': 'Blocked' }),
      DIDReputation.countDocuments({ isBlacklisted: true }),
      DIDReputation.countDocuments({
        isBlacklisted: { $ne: true },
        nextCheckDue: { $lte: new Date() }
      })
    ]);

    const avgScore = await DIDReputation.aggregate([
      { $group: { _id: null, avgScore: { $avg: '$reputationScore' } } }
    ]);

    return {
      summary: {
        totalDIDsChecked: totalDIDs,
        positiveDIDs,
        negativeDIDs,
        blockedDIDs,
        blacklistedDIDs,
        averageReputationScore: avgScore[0]?.avgScore || 0,
        didsNeedingCheck: needsCheck
      },
      timestamp: new Date()
    };
  }

  /**
   * Get blacklisted DIDs
   */
  async getBlacklistedDIDs(limit = 100) {
    return await DIDReputation.find({
      isBlacklisted: true
    })
    .limit(limit)
    .sort({ blacklistedAt: -1 });
  }

  /**
   * Manually unblacklist a DID (for administrative purposes)
   */
  async unblacklistDID(phoneNumber) {
    const reputation = await DIDReputation.findOne({ phoneNumber });

    if (!reputation) {
      throw new Error(`DID ${phoneNumber} not found in reputation database`);
    }

    if (!reputation.isBlacklisted) {
      return reputation; // Already not blacklisted
    }

    // Remove blacklist status and set next check date
    reputation.isBlacklisted = false;
    reputation.blacklistedAt = null;
    reputation.nextCheckDue = new Date(Date.now() + this.checkInterval.neutral);
    reputation.updatedAt = new Date();

    await reputation.save();
    console.log(`✅ Unblacklisted DID: ${phoneNumber}`);

    return reputation;
  }
}

// Export singleton instance
export default new ReputationService();