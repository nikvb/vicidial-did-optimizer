// Dedicated reputation-scraper worker process.
//
// Runs the RoboKiller reputation scraper OUT of the web server so heavy
// scraping can never starve the login/API event loop (2026-08-29 outage: an
// 81k in-process Bull backlog saturated did-optimizer's loop → Cloudflare 520s
// → users couldn't log in). This process owns BOTH the cron producer
// (background-scraper-service) and the queue consumers (startReputationWorkers).
// The web server (server-full.js) keeps only the lightweight producer
// (enqueueReputationCheck) for on-demand high-priority checks.
import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';

// Register the models the scraper/queue look up via mongoose.model(...).
import './models/DID.js';
import './models/Tenant.js';
import './models/User.js';
import './services/reputation-service.js'; // registers DIDReputation

import backgroundScraperService from './services/background-scraper-service.js';
import { startReputationWorkers, getQueueStatus } from './services/reputation-queue.js';

// Same connection posture as the web server: fail fast instead of buffering
// operations against a dropped connection.
mongoose.set('bufferCommands', false);

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/did-optimizer');
  console.log('✅ [scraper-worker] MongoDB connected');

  // Consumers first (drain anything already queued), then the cron producer.
  startReputationWorkers();
  backgroundScraperService.start();

  const status = await getQueueStatus();
  console.log(`✅ [scraper-worker] up — queue: ${JSON.stringify(status)}`);
}

main().catch((err) => {
  console.error('❌ [scraper-worker] fatal startup error:', err);
  process.exit(1);
});

async function shutdown(sig) {
  console.log(`\n⏹️ [scraper-worker] ${sig} received — stopping scraper`);
  try { backgroundScraperService.stop(); } catch {}
  try { await mongoose.connection.close(); } catch {}
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
