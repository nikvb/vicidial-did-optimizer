#!/usr/bin/env node

import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

// Import DID model
import DID from './models/DID.js';

// Import crawl4ai service
import crawl4aiService from './temp_clone/services/crawl4ai-service.js';

const phoneNumbers = [
  '2344946001',
  '2344946000',
  '2344945999',
  '2344945998',
  '2344945997',
  '2344945996',
  '2344945995'
];

function calculateReputationScore(data) {
  let score = 50;
  if (data.reputationStatus === 'Positive') score += 30;
  else if (data.reputationStatus === 'Negative') score -= 40;
  if (data.robokillerStatus === 'Allowed') score += 10;
  else if (data.robokillerStatus === 'Blocked') score -= 30;
  if (data.userReports > 10) score -= 20;
  else if (data.userReports > 5) score -= 10;
  if (data.spamScore !== null && data.spamScore !== undefined) {
    score = Math.round((score + (100 - data.spamScore)) / 2);
  }
  return Math.max(0, Math.min(100, score));
}

async function main() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/did-optimizer');
    console.log('✅ MongoDB connected\n');

    await crawl4aiService.init();
    console.log('✅ Crawl4AI service ready\n');

    let processed = 0;
    let success = 0;
    let errors = 0;

    for (const phoneNumber of phoneNumbers) {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`🕷️  Processing: ${phoneNumber}`);

      try {
        // Find DID in database
        const did = await DID.findOne({ phoneNumber: `+1${phoneNumber}` });

        if (!did) {
          console.log(`⚠️  DID not found in database: +1${phoneNumber}`);
          errors++;
          processed++;
          continue;
        }

        console.log(`🆔 Found DID: ${did._id}`);

        // Scrape reputation data
        const result = await crawl4aiService.scrapeRoboKillerData(phoneNumber, false);

        if (result.success && result.data) {
          const reputationData = result.data;
          const score = calculateReputationScore(reputationData);

          console.log(`📊 Reputation: ${reputationData.reputationStatus}`);
          console.log(`📊 RoboKiller: ${reputationData.robokillerStatus}`);
          console.log(`📊 Total Calls: ${reputationData.totalCalls || 'N/A'}`);
          console.log(`📊 Score: ${score}`);

          // Update DID
          did.reputation = {
            score: score,
            status: reputationData.reputationStatus || 'Unknown',
            lastChecked: new Date(),
            robokillerData: reputationData
          };

          await did.save();
          console.log('✅ Updated successfully');
          success++;
        } else {
          console.log(`❌ Failed: ${result.error}`);
          errors++;
        }

        processed++;

        // Wait 2 seconds between requests
        if (processed < phoneNumbers.length) {
          console.log('⏳ Waiting 2 seconds...');
          await new Promise(resolve => setTimeout(resolve, 2000));
        }

      } catch (error) {
        console.error(`❌ Error: ${error.message}`);
        errors++;
        processed++;
      }
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log('📊 SUMMARY');
    console.log(`${'='.repeat(60)}`);
    console.log(`Total: ${processed}`);
    console.log(`Success: ${success}`);
    console.log(`Errors: ${errors}`);

  } catch (error) {
    console.error('💥 Fatal error:', error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

main();
