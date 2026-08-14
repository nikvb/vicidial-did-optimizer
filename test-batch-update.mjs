#!/usr/bin/env node
/**
 * Test script: scrape 10 DIDs and verify DB update
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Connect to DB
await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/did-optimizer');
console.log('✅ Connected to MongoDB:', mongoose.connection.db.databaseName);

// Import DID model
const { default: DID } = await import('./models/DID.js');

// Get 10 test DIDs
const testDIDs = await DID.find({ isActive: true, status: 'active' }, { phoneNumber: 1, 'reputation.lastChecked': 1, 'reputation.score': 1 }).limit(10);
console.log(`\n📋 Testing with ${testDIDs.length} DIDs:`);
testDIDs.forEach(d => console.log(`  ${d.phoneNumber} | score=${d.reputation?.score} | lastChecked=${d.reputation?.lastChecked}`));

// Format phone numbers (strip non-digits, remove leading 1 from 11-digit)
const phoneNumbers = testDIDs.map(d => {
  let cleaned = d.phoneNumber.replace(/\D/g, '');
  if (cleaned.startsWith('1') && cleaned.length === 11) cleaned = cleaned.substring(1);
  return cleaned;
});

console.log(`\n🕷️ Running fast scraper on: ${phoneNumbers.join(', ')}`);

// Run Python batch scraper
const scrapeResults = await new Promise((resolve) => {
  const scriptPath = path.join(__dirname, 'scripts', 'fast_robokiller_scraper.py');
  const args = [scriptPath, `--numbers=${phoneNumbers.join(',')}`, `--concurrency=${phoneNumbers.length}`];

  let stdout = '';
  const python = spawn('python3', args);
  python.stdout.on('data', d => { stdout += d.toString(); });
  python.stderr.on('data', d => { process.stderr.write(d); });

  setTimeout(() => { python.kill('SIGTERM'); resolve([]); }, 30000);

  python.on('close', () => {
    try {
      const lines = stdout.split('\n');
      const jsonLine = lines.find(l => l.startsWith('{') && l.includes('"batch"'));
      if (!jsonLine) { console.error('No batch JSON'); resolve([]); return; }
      const parsed = JSON.parse(jsonLine);
      resolve(parsed.results);
    } catch (e) {
      console.error('Parse error:', e.message);
      resolve([]);
    }
  });
});

console.log(`\n✅ Got ${scrapeResults.length} scrape results`);

// Calculate reputation score
function calcScore(data) {
  let score = 50;
  if (data.reputationStatus === 'Positive') score += 30;
  else if (data.reputationStatus === 'Negative') score -= 30;
  if (data.userReports > 0) score -= Math.min(data.userReports * 2, 20);
  if (data.robokillerStatus === 'Blocked') score -= 20;
  else if (data.robokillerStatus === 'Allowed') score += 10;
  if (data.spamScore != null) score -= data.spamScore / 5;
  return Math.max(0, Math.min(100, Math.round(score)));
}

// Update DB for each successful result
let updated = 0;
const updateResults = [];

for (const r of scrapeResults) {
  if (!r.success || !r.data) {
    console.log(`  ❌ SKIP ${r.phone}: ${r.error}`);
    updateResults.push({ phone: r.phone, success: false, error: r.error });
    continue;
  }

  const robokillerData = r.data;
  const reputationScore = calcScore(robokillerData);
  const isNegative = robokillerData.reputationStatus === 'Negative';

  const didUpdate = {
    'reputation.score': reputationScore,
    'reputation.status': robokillerData.reputationStatus,
    'reputation.lastChecked': new Date(),
    'reputation.robokillerData': robokillerData
  };

  // Use regex to match +1XXXXXXXXXX → XXXXXXXXXX
  const regex = new RegExp(r.phone.replace(/\D/g, '') + '$');

  try {
    const result = await DID.findOneAndUpdate(
      { phoneNumber: regex },
      { $set: didUpdate },
      { new: true, select: 'phoneNumber reputation.score reputation.status reputation.lastChecked' }
    );

    if (result) {
      updated++;
      console.log(`  ✅ Updated ${result.phoneNumber}: score=${result.reputation.score}, status=${result.reputation.status}`);
      updateResults.push({
        phone: r.phone,
        fullPhone: result.phoneNumber,
        success: true,
        scraped: robokillerData,
        dbScore: result.reputation.score,
        dbStatus: result.reputation.status,
        dbLastChecked: result.reputation.lastChecked
      });
    } else {
      console.log(`  ⚠️ NOT FOUND in DB: ${r.phone} (regex: ${regex})`);
      updateResults.push({ phone: r.phone, success: false, error: 'Not found in DB' });
    }
  } catch (err) {
    console.error(`  ❌ DB error for ${r.phone}:`, err.message);
    updateResults.push({ phone: r.phone, success: false, error: err.message });
  }
}

console.log(`\n📊 Updated ${updated}/${scrapeResults.length} DIDs in database`);

// Verify by re-reading from DB
console.log('\n🔍 VERIFICATION - Re-reading from DB:');
const verified = await DID.find({ isActive: true, status: 'active' }, {
  phoneNumber: 1,
  'reputation.score': 1,
  'reputation.status': 1,
  'reputation.lastChecked': 1,
  'reputation.robokillerData': 1
}).limit(10);

verified.forEach(d => {
  const data = d.reputation?.robokillerData;
  console.log(`  ${d.phoneNumber}:`);
  console.log(`    score=${d.reputation?.score}, status=${d.reputation?.status}`);
  console.log(`    lastChecked=${d.reputation?.lastChecked}`);
  console.log(`    reports=${data?.userReports}, totalCalls=${data?.totalCalls}, lastCall=${data?.lastCallDate}`);
  console.log(`    robokillerStatus=${data?.robokillerStatus}, callerName=${data?.callerName}`);
});

await mongoose.disconnect();
process.exit(0);
