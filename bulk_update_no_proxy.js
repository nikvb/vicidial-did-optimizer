#!/usr/bin/env node

/**
 * Fast Bulk Reputation Update Script - NO PROXY VERSION
 * Much faster but may hit rate limits with large batches
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import crawl4aiService from './services/crawl4ai-service.js';

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

// DID Schema
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
      screenshot: String
    }
  },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const DID = mongoose.model('DID', didSchema);

function cleanPhoneNumber(phoneNumber) {
  return phoneNumber.replace(/^\+?1?/, '').replace(/\D/g, '');
}

function calculateScore(data) {
  let score = 50;
  if (data.reputationStatus === 'Positive') score += 30;
  else if (data.reputationStatus === 'Negative') score -= 30;
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
    const cleanNumber = cleanPhoneNumber(did.phoneNumber);

    if (cleanNumber.length !== 10) {
      console.log(`⚠️  Invalid phone number format: ${did.phoneNumber} -> ${cleanNumber}`);
      return { success: false, error: 'Invalid phone format' };
    }

    // NO PROXY - Direct connection
    const result = await crawl4aiService.scrapeRoboKillerData(cleanNumber, false);

    const duration = (Date.now() - startTime) / 1000;

    if (result.success) {
      const score = calculateScore(result.data);
      const robokillerData = {
        ...result.data,
        screenshot: result.screenshot || null
      };

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

async function bulkUpdateNoProxy() {
  await connectDB();

  const forceUpdate = process.argv.includes('--force') || process.argv.includes('-f');

  console.log('🚀 BULK REPUTATION UPDATE - NO PROXY (FASTER)');
  if (forceUpdate) {
    console.log('⚠️  FORCE MODE: Updating ALL DIDs');
  }
  console.log('='.repeat(80));

  // Wait for service
  console.log('⏳ Waiting for Crawl4AI service...');
  let attempts = 0;
  while (!crawl4aiService.isReady && attempts < 30) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    attempts++;
  }

  if (!crawl4aiService.isReady) {
    console.error('❌ Crawl4AI service failed to initialize');
    process.exit(1);
  }

  console.log('✅ Crawl4AI service ready!');

  let query = { isActive: true };

  if (!forceUpdate) {
    query.$or = [
      { 'reputation.lastChecked': { $exists: false } },
      { 'reputation.lastChecked': { $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } }
    ];
  }

  const didsToUpdate = await DID.find(query);

  console.log(`📱 Found ${didsToUpdate.length} DIDs to process`);

  if (didsToUpdate.length === 0) {
    console.log('✅ All DIDs are up to date!');
    mongoose.disconnect();
    return;
  }

  const results = {
    total: didsToUpdate.length,
    successful: 0,
    failed: 0,
    vllm: 0,
    regex: 0,
    totalTime: 0
  };

  const batchSize = 3; // Smaller batch to avoid rate limits without proxy
  const delayMs = 3000; // 3 second delay between batches

  console.log(`🔄 Processing ${results.total} DIDs in batches of ${batchSize} with ${delayMs}ms delays...`);
  console.log('');

  for (let i = 0; i < didsToUpdate.length; i += batchSize) {
    const batch = didsToUpdate.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(didsToUpdate.length / batchSize);

    console.log(`📦 Batch ${batchNum}/${totalBatches} (DIDs ${i + 1}-${Math.min(i + batchSize, didsToUpdate.length)})`);

    const batchPromises = batch.map(updateSingleDID);
    const batchResults = await Promise.all(batchPromises);

    for (const result of batchResults) {
      if (result.success) {
        results.successful++;
        if (result.method === 'vllm_extraction') results.vllm++;
        else results.regex++;
        results.totalTime += result.duration;
      } else {
        results.failed++;
      }
    }

    console.log(`📊 Progress: ${((i + batch.length) / didsToUpdate.length * 100).toFixed(1)}% - Success: ${results.successful}, Failed: ${results.failed}\n`);

    // Delay between batches
    if (i + batchSize < didsToUpdate.length) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  console.log('='.repeat(80));
  console.log('🎉 BULK UPDATE COMPLETED!');
  console.log('='.repeat(80));
  console.log(`📊 RESULTS:`);
  console.log(`  Total DIDs processed: ${results.total}`);
  console.log(`  ✅ Successful: ${results.successful}`);
  console.log(`  ❌ Failed: ${results.failed}`);
  console.log(`  🤖 vLLM extractions: ${results.vllm}`);
  console.log(`  📝 Regex extractions: ${results.regex}`);
  console.log(`  ⏱️  Total time: ${results.totalTime.toFixed(2)}s`);
  console.log(`  ⚡ Average time per DID: ${(results.totalTime / results.total).toFixed(2)}s`);

  mongoose.disconnect();
}

bulkUpdateNoProxy().catch(console.error);
