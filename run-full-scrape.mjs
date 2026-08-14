#!/usr/bin/env node
/**
 * Run full reputation scrape for ALL DIDs
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BATCH_SIZE = 50; // 50 concurrent per Python process
const DELAY_MS = 200;

await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/did-optimizer');
console.log('✅ Connected to:', mongoose.connection.db.databaseName);

const { default: DID } = await import('./models/DID.js');

// Get ALL active DIDs
const allDIDs = await DID.find({ isActive: true, status: 'active' }, { phoneNumber: 1 });
console.log(`📋 Total active DIDs: ${allDIDs.length}`);

// Format phone numbers
const phoneNumbers = allDIDs.map(d => {
  let cleaned = d.phoneNumber.replace(/\D/g, '');
  if (cleaned.startsWith('1') && cleaned.length === 11) cleaned = cleaned.substring(1);
  return cleaned;
});

function calcScore(data) {
  let score = 50;
  if (data.reputationStatus === 'Positive') score += 30;
  else if (data.reputationStatus === 'Negative') score -= 30;
  if (data.userReports > 0) score -= Math.min(data.userReports * 2, 20);
  if (data.robokillerStatus === 'Blocked') score -= 20;
  else if (data.robokillerStatus === 'Allowed') score += 10;
  return Math.max(0, Math.min(100, Math.round(score)));
}

async function runBatch(phones) {
  return new Promise((resolve) => {
    const scriptPath = path.join(__dirname, 'scripts', 'fast_robokiller_scraper.py');
    const args = [scriptPath, `--numbers=${phones.join(',')}`, `--concurrency=${phones.length}`];
    let stdout = '';
    const p = spawn('python3', args);
    p.stdout.on('data', d => { stdout += d.toString(); });
    const t = setTimeout(() => { p.kill('SIGTERM'); resolve([]); }, 90000);
    p.on('close', () => {
      clearTimeout(t);
      try {
        const line = stdout.split('\n').find(l => l.startsWith('{') && l.includes('"batch"'));
        if (!line) { resolve([]); return; }
        resolve(JSON.parse(line).results);
      } catch { resolve([]); }
    });
  });
}

const startTime = Date.now();
let totalUpdated = 0;
let totalFailed = 0;
let totalBatches = Math.ceil(phoneNumbers.length / BATCH_SIZE);

console.log(`\n🚀 Starting full scrape: ${phoneNumbers.length} DIDs in ${totalBatches} batches of ${BATCH_SIZE}`);

for (let i = 0; i < phoneNumbers.length; i += BATCH_SIZE) {
  const batch = phoneNumbers.slice(i, i + BATCH_SIZE);
  const batchNum = Math.floor(i / BATCH_SIZE) + 1;

  process.stdout.write(`\r⏳ Batch ${batchNum}/${totalBatches} | Updated: ${totalUpdated} | Failed: ${totalFailed}    `);

  const results = await runBatch(batch);

  // Bulk update DB
  const bulkOps = [];
  for (const r of results) {
    if (!r.success || !r.data) { totalFailed++; continue; }
    const score = calcScore(r.data);
    bulkOps.push({
      updateOne: {
        filter: { phoneNumber: new RegExp(r.phone + '$') },
        update: { $set: {
          'reputation.score': score,
          'reputation.status': r.data.reputationStatus,
          'reputation.lastChecked': new Date(),
          'reputation.robokillerData': r.data
        }}
      }
    });
  }

  if (bulkOps.length > 0) {
    const res = await DID.bulkWrite(bulkOps, { ordered: false });
    totalUpdated += res.modifiedCount;
    totalFailed += (batch.length - res.modifiedCount);
  }

  if (i + BATCH_SIZE < phoneNumbers.length && DELAY_MS > 0) {
    await new Promise(resolve => setTimeout(resolve, DELAY_MS));
  }
}

const elapsed = Math.round((Date.now() - startTime) / 1000);
console.log(`\n\n✅ COMPLETE: ${totalUpdated} updated, ${totalFailed} failed in ${elapsed}s (${Math.round(phoneNumbers.length / elapsed)}/sec)`);

await mongoose.disconnect();
