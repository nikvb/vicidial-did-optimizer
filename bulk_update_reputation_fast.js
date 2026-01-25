#!/usr/bin/env node

/**
 * Fast Bulk Reputation Update Script
 *
 * Updates DID reputation scores using Crawl4AI + OpenRouter LLM + Webshare proxies
 *
 * Usage:
 *   node bulk_update_reputation_fast.js           # Update DIDs not checked in 1 day
 *   node bulk_update_reputation_fast.js --force   # Force update ALL active DIDs
 *   node bulk_update_reputation_fast.js -f        # Short form of --force
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import crawl4aiService from './services/crawl4ai-service.js';

// Show help if requested
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
📚 Fast Bulk Reputation Update Script

Updates DID reputation scores using:
  • Crawl4AI for web scraping
  • OpenRouter LLM for intelligent data extraction
  • Webshare proxy rotation to avoid rate limits

Usage:
  node bulk_update_reputation_fast.js           # Update DIDs not checked in 1 day
  node bulk_update_reputation_fast.js --force   # Force update ALL active DIDs
  node bulk_update_reputation_fast.js -f        # Short form of --force

Flags:
  --force, -f    Force update all active DIDs regardless of last check time
  --help, -h     Show this help message

Examples:
  # Normal update (only DIDs older than 1 day)
  node bulk_update_reputation_fast.js

  # Force update all DIDs
  node bulk_update_reputation_fast.js --force

  # Run in background with logging
  node bulk_update_reputation_fast.js --force > reputation.log 2>&1 &
  tail -f reputation.log
`);
  process.exit(0);
}

// Load environment variables
dotenv.config();

// Connect to MongoDB
async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
}

// DID Schema (simplified)
const didSchema = new mongoose.Schema({
  phoneNumber: String,
  reputation: {
    score: Number,
    status: { type: String, enum: ['Unknown', 'Positive', 'Negative', 'Neutral'], default: 'Unknown' },
    lastChecked: Date,
    robokillerData: {
      userReports: Number,
      reputationStatus: String,
      totalCalls: Number,
      lastCallDate: String,
      robokillerStatus: String,
      spamScore: Number,
      callerName: String,
      location: String,
      carrier: String,
      commentsCount: Number,
      screenshot: String  // Filename of the screenshot
    }
  },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const DID = mongoose.model('DID', didSchema);

function cleanPhoneNumber(phoneNumber) {
  // Remove +1 prefix and any non-digits
  return phoneNumber.replace(/^\+?1?/, '').replace(/\D/g, '');
}

function calculateScore(data) {
  // Calculate reputation score based on OpenRouter data
  let score = 50; // Base score

  if (data.reputationStatus === 'Positive') score += 30;
  else if (data.reputationStatus === 'Negative') score -= 30;
  else if (data.reputationStatus === 'Neutral') score += 0;

  if (data.robokillerStatus === 'Allowed') score += 20;
  else if (data.robokillerStatus === 'Blocked') score -= 20;

  if (data.userReports > 0) score -= Math.min(data.userReports * 5, 25);
  if (data.totalCalls > 5) score += Math.min((data.totalCalls - 5) * 2, 15);

  return Math.max(0, Math.min(100, score));
}

async function updateSingleDID(did) {
  const startTime = Date.now();
  console.log(`🔍 Processing ${did.phoneNumber}...`);

  try {
    // Clean phone number for RoboKiller format
    const cleanNumber = cleanPhoneNumber(did.phoneNumber);

    if (cleanNumber.length !== 10) {
      console.log(`⚠️  Invalid phone number format: ${did.phoneNumber} -> ${cleanNumber}`);
      return { success: false, error: 'Invalid phone format' };
    }

    // Use the fixed OpenRouter integration
    const result = await crawl4aiService.scrapeRoboKillerData(cleanNumber, true); // Use proxy

    const duration = (Date.now() - startTime) / 1000;

    if (result.success) {
      // Calculate reputation score
      const score = calculateScore(result.data);

      // Prepare robokillerData with screenshot
      const robokillerData = {
        ...result.data,
        screenshot: result.screenshot || null  // Add screenshot filename from scraper
      };

      // Update DID in database
      await DID.findByIdAndUpdate(did._id, {
        $set: {
          'reputation.score': score,
          'reputation.status': result.data.reputationStatus || 'Unknown',
          'reputation.lastChecked': new Date(),
          'reputation.robokillerData': robokillerData,
          'updatedAt': new Date()
        }
      });

      const screenshotInfo = result.screenshot ? ` 📸 ${result.screenshot}` : '';
      console.log(`✅ ${did.phoneNumber}: ${result.data.reputationStatus} (Score: ${score}) - ${result.method} - ${duration.toFixed(2)}s${screenshotInfo}`);
      return { success: true, data: result.data, score, method: result.method, duration };
    } else {
      console.log(`❌ ${did.phoneNumber}: Failed - ${result.error} - ${duration.toFixed(2)}s`);
      return { success: false, error: result.error, duration };
    }
  } catch (error) {
    const duration = (Date.now() - startTime) / 1000;
    console.log(`💥 ${did.phoneNumber}: Exception - ${error.message} - ${duration.toFixed(2)}s`);
    return { success: false, error: error.message, duration };
  }
}

async function bulkUpdateReputationFast() {
  await connectDB();

  // Check for --force flag
  const forceUpdate = process.argv.includes('--force') || process.argv.includes('-f');

  console.log('🚀 FAST BULK REPUTATION UPDATE - Proxy Rotation (No Delays)');
  if (forceUpdate) {
    console.log('⚠️  FORCE MODE: Updating ALL DIDs regardless of last check time');
  }
  console.log('='.repeat(80));

  // Wait for Crawl4AI service to be ready
  console.log('⏳ Waiting for Crawl4AI service to initialize...');
  let attempts = 0;
  while (!crawl4aiService.isReady && attempts < 30) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    attempts++;
    console.log(`⏳ Attempt ${attempts}/30 - Ready: ${crawl4aiService.isReady}`);
  }

  if (!crawl4aiService.isReady) {
    console.error('❌ Crawl4AI service failed to initialize');
    process.exit(1);
  }

  console.log('✅ Crawl4AI service ready!');

  // Get DIDs needing reputation check
  let query = { isActive: true };

  if (!forceUpdate) {
    // Only update DIDs that haven't been checked in 48 hours
    query.$or = [
      { 'reputation.lastChecked': { $exists: false } },
      { 'reputation.lastChecked': { $lt: new Date(Date.now() - 48 * 60 * 60 * 1000) } }
    ];
  }

  const didsToUpdate = await DID.find(query); // Process based on force flag

  console.log(`📱 Found ${didsToUpdate.length} DIDs ${forceUpdate ? 'to force update' : 'needing reputation check'}`);

  if (didsToUpdate.length === 0) {
    console.log('✅ All DIDs are up to date!');
    mongoose.disconnect();
    return;
  }

  const results = {
    total: didsToUpdate.length,
    successful: 0,
    failed: 0,
    openrouter: 0,
    regex: 0,
    totalTime: 0,
    errors: []
  };

  const batchSize = 3; // Reduced batch size to limit concurrent processes
  const delayBetweenBatches = 5000; // 5 second delay between batches
  const maxDidsPerRun = 200; // Maximum DIDs to process per run

  // Limit DIDs per run to avoid resource exhaustion
  const limitedDids = didsToUpdate.slice(0, maxDidsPerRun);
  if (didsToUpdate.length > maxDidsPerRun) {
    console.log(`⚠️  Limiting to ${maxDidsPerRun} DIDs per run (${didsToUpdate.length} total need checking)`);
  }

  console.log(`🔄 Processing ${limitedDids.length} DIDs in batches of ${batchSize} with ${delayBetweenBatches/1000}s delay...`);
  console.log('');

  for (let i = 0; i < limitedDids.length; i += batchSize) {
    const batch = limitedDids.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(limitedDids.length / batchSize);

    console.log(`📦 Batch ${batchNum}/${totalBatches} (DIDs ${i + 1}-${Math.min(i + batchSize, limitedDids.length)})`);

    // Process batch in parallel with proxy rotation
    const batchPromises = batch.map(updateSingleDID);
    const batchResults = await Promise.all(batchPromises);

    // Update statistics
    for (const result of batchResults) {
      if (result.success) {
        results.successful++;
        if (result.method === 'enhanced_openrouter_extraction') {
          results.openrouter++;
        } else {
          results.regex++;
        }
      } else {
        results.failed++;
        results.errors.push(result.error);
      }
      results.totalTime += result.duration || 0;
    }

    // Progress update
    const progress = ((i + batchSize) / limitedDids.length * 100).toFixed(1);
    console.log(`📊 Progress: ${progress}% - Success: ${results.successful}, Failed: ${results.failed}`);

    // Delay between batches to prevent resource exhaustion
    if (i + batchSize < limitedDids.length) {
      console.log(`⏳ Waiting ${delayBetweenBatches/1000}s before next batch...`);
      await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
    }
    console.log('');
  }

  console.log('\n' + '='.repeat(80));
  console.log('🎉 FAST BULK UPDATE COMPLETED!');
  console.log('='.repeat(80));
  console.log(`📊 RESULTS:`);
  console.log(`  Total DIDs processed: ${results.total}`);
  console.log(`  ✅ Successful: ${results.successful}`);
  console.log(`  ❌ Failed: ${results.failed}`);
  console.log(`  🤖 OpenRouter extractions: ${results.openrouter}`);
  console.log(`  📝 Regex extractions: ${results.regex}`);
  console.log(`  ⏱️  Total time: ${results.totalTime.toFixed(2)}s`);
  console.log(`  ⚡ Average time per DID: ${(results.totalTime / results.total).toFixed(2)}s`);

  if (results.errors.length > 0) {
    console.log(`\n❌ ERRORS (first 5):`);
    for (const error of results.errors.slice(0, 5)) {
      console.log(`  • ${error}`);
    }
  }

  // Final status check
  const finalStats = await DID.aggregate([
    { $match: { isActive: true } },
    { $group: { _id: '$reputation.status', count: { $sum: 1 } } },
    { $sort: { _id: 1 } }
  ]);

  console.log('\n🎯 FINAL REPUTATION STATUS:');
  for (const stat of finalStats) {
    console.log(`  ${stat._id || 'Unknown'}: ${stat.count}`);
  }

  mongoose.disconnect();
}

bulkUpdateReputationFast().catch(console.error);