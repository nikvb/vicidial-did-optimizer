#!/usr/bin/env node

/**
 * Test script to capture screenshot for a single DID
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
  else if (data.reputationStatus === 'Neutral') score += 0;

  if (data.robokillerStatus === 'Allowed') score += 20;
  else if (data.robokillerStatus === 'Blocked') score -= 20;

  if (data.userReports > 0) score -= Math.min(data.userReports * 5, 25);
  if (data.totalCalls > 5) score += Math.min((data.totalCalls - 5) * 2, 15);

  return Math.max(0, Math.min(100, score));
}

async function testScreenshotCapture(phoneNumber) {
  await connectDB();

  console.log(`🔍 Testing screenshot capture for ${phoneNumber}...`);
  console.log('='.repeat(80));

  // Wait for Crawl4AI service
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

  // Find the DID
  const did = await DID.findOne({
    $or: [
      { phoneNumber: phoneNumber },
      { phoneNumber: `+${phoneNumber}` },
      { phoneNumber: phoneNumber.replace(/^\+/, '') }
    ]
  });

  if (!did) {
    console.error(`❌ DID ${phoneNumber} not found in database`);
    mongoose.disconnect();
    return;
  }

  console.log(`📱 Found DID: ${did.phoneNumber}`);

  const startTime = Date.now();
  const cleanNumber = cleanPhoneNumber(did.phoneNumber);

  try {
    const result = await crawl4aiService.scrapeRoboKillerData(cleanNumber, true);
    const duration = (Date.now() - startTime) / 1000;

    if (result.success) {
      const score = calculateScore(result.data);

      // Prepare robokillerData with screenshot
      const robokillerData = {
        ...result.data,
        screenshot: result.screenshot || null
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

      console.log('');
      console.log('✅ SUCCESS!');
      console.log('='.repeat(80));
      console.log(`📊 Reputation Status: ${result.data.reputationStatus}`);
      console.log(`💯 Score: ${score}/100`);
      console.log(`⏱️  Duration: ${duration.toFixed(2)}s`);
      console.log(`🔧 Method: ${result.method}`);

      if (result.screenshot) {
        console.log(`📸 Screenshot saved: ${result.screenshot}`);
        console.log(`🌐 URL: https://dids.amdy.io/screenshots/${result.screenshot}`);
      } else {
        console.log(`⚠️  No screenshot captured`);
      }

      console.log('');
      console.log('📋 RoboKiller Data:');
      console.log(`  • User Reports: ${result.data.userReports || 0}`);
      console.log(`  • Total Calls: ${result.data.totalCalls || 0}`);
      console.log(`  • Status: ${result.data.robokillerStatus || 'Unknown'}`);
      console.log(`  • Caller Name: ${result.data.callerName || 'N/A'}`);
      console.log(`  • Location: ${result.data.location || 'N/A'}`);

    } else {
      console.error(`❌ Failed: ${result.error}`);
    }

  } catch (error) {
    console.error(`💥 Exception: ${error.message}`);
  }

  mongoose.disconnect();
}

// Get phone number from command line
const phoneNumber = process.argv[2] || '+12097999082';
testScreenshotCapture(phoneNumber);
