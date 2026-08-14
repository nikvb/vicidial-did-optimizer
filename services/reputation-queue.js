import Bull from 'bull';
import mongoose from 'mongoose';
import reputationService from './reputation-service.js';

const REDIS = { host: '127.0.0.1', port: 6379 };
const BATCH_SIZE = 200;   // DIDs per job
const CONCURRENCY = 3;    // parallel workers

export const reputationQueue = new Bull('did-reputation', { redis: REDIS });

const AUTO_DISABLE_THRESHOLD = 40;

// ── Workers ─────────────────────────────────────────────────────────────────
reputationQueue.process(CONCURRENCY, async (job) => {
  const { phoneNumbers } = job.data;
  job.progress(0);
  const results = await reputationService.bulkUpdateReputation(phoneNumbers, {
    batchSize: 20,
    delayMs: 300,
    useCrawl4AI: true,
  });
  job.progress(100);
  const ok = results.filter(r => r.success).length;

  // Auto-disable DIDs whose reputation dropped below threshold
  try {
    const DIDReputation = mongoose.model('DIDReputation');
    const DID = mongoose.model('DID');

    const lowScoreReps = await DIDReputation.find({
      phoneNumber: { $in: phoneNumbers },
      score: { $lt: AUTO_DISABLE_THRESHOLD }
    }).lean();

    if (lowScoreReps.length > 0) {
      const lowPhones = lowScoreReps.map(r => r.phoneNumber);
      // Match all common DID phone formats (+1XXXXXXXXXX, 1XXXXXXXXXX, XXXXXXXXXX)
      const phoneVariants = lowPhones.flatMap(p => [`+1${p}`, `1${p}`, p]);
      const updated = await DID.updateMany(
        { phoneNumber: { $in: phoneVariants }, status: 'active' },
        { $set: { status: 'inactive', updatedAt: new Date() } }
      );
      if (updated.modifiedCount > 0) {
        console.log(`🚫 Auto-disabled ${updated.modifiedCount} DID(s) with score < ${AUTO_DISABLE_THRESHOLD}`);
      }
    }
  } catch (autoDisableErr) {
    console.error('⚠️ Auto-disable check failed:', autoDisableErr.message);
  }

  return { total: phoneNumbers.length, success: ok, failed: phoneNumbers.length - ok };
});

reputationQueue.on('completed', (job, result) => {
  console.log(`✅ Rep-queue job ${job.id}: ${result.success}/${result.total} ok`);
});
reputationQueue.on('failed', (job, err) => {
  console.error(`❌ Rep-queue job ${job.id} failed:`, err.message);
});

// ── Producer helper ──────────────────────────────────────────────────────────
/**
 * Enqueue phone numbers for reputation checking.
 * @param {string[]} phoneNumbers  10-digit cleaned numbers
 * @param {'high'|'normal'} priority  high = new uploads, normal = cron rechecks
 */
export async function enqueueReputationCheck(phoneNumbers, priority = 'normal') {
  if (!phoneNumbers.length) return;
  const jobPriority = priority === 'high' ? 1 : 10;
  const jobs = [];
  for (let i = 0; i < phoneNumbers.length; i += BATCH_SIZE) {
    const batch = phoneNumbers.slice(i, i + BATCH_SIZE);
    // jobId deduplication: same first number + batch length won't be re-queued
    const jobId = `${batch[0]}-${batch.length}-${Math.floor(Date.now() / 60000)}`;
    jobs.push({
      data: { phoneNumbers: batch },
      opts: { priority: jobPriority, attempts: 2, backoff: { type: 'exponential', delay: 10000 }, jobId },
    });
  }
  await reputationQueue.addBulk(jobs);
  console.log(`📬 Enqueued ${phoneNumbers.length} DIDs (${jobs.length} jobs, priority=${priority})`);
}

// ── Queue status helper ──────────────────────────────────────────────────────
export async function getQueueStatus() {
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    reputationQueue.getWaitingCount(),
    reputationQueue.getActiveCount(),
    reputationQueue.getCompletedCount(),
    reputationQueue.getFailedCount(),
    reputationQueue.getDelayedCount(),
  ]);
  return { waiting, active, completed, failed, delayed };
}
