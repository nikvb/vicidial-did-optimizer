#!/usr/bin/env node

/**
 * VICIdial Call Results Processor
 *
 * Polls vicidial_log table for new completed calls and sends them to DID Optimizer API
 * Runs via cron every minute
 */

import mysql from 'mysql2/promise';
import axios from 'axios';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const LAST_CHECK_FILE = '/tmp/did-optimizer-last-check.txt';
const LOG_FILE = '/var/log/did-optimizer-sync.log';
const BATCH_SIZE = 500;

// VICIdial database connection
const VICIDIAL_DB_CONFIG = {
  host: process.env.VICIDIAL_DB_HOST || 'localhost',
  user: process.env.VICIDIAL_DB_USER || 'cron',
  password: process.env.VICIDIAL_DB_PASSWORD || '1234',
  database: process.env.VICIDIAL_DB_NAME || 'asterisk'
};

// DID Optimizer API configuration
const API_URL = process.env.DID_OPTIMIZER_API_URL || 'http://localhost:5000';
const API_KEY = process.env.API_KEY;

if (!API_KEY) {
  console.error('❌ API_KEY environment variable is required');
  process.exit(1);
}

function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}`;
  console.log(logMessage);

  // Append to log file
  try {
    fs.appendFileSync(LOG_FILE, logMessage + '\n');
  } catch (error) {
    // Ignore log file errors
  }
}

async function getLastCheckTime() {
  try {
    if (fs.existsSync(LAST_CHECK_FILE)) {
      const content = fs.readFileSync(LAST_CHECK_FILE, 'utf8').trim();
      log(`📅 Last check: ${content}`);
      return content;
    }
  } catch (error) {
    log(`⚠️  Could not read last check file: ${error.message}`);
  }

  // Default to 1 hour ago if no checkpoint exists
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const defaultTime = oneHourAgo.toISOString().slice(0, 19).replace('T', ' ');
  log(`📅 Using default start time: ${defaultTime}`);
  return defaultTime;
}

function saveLastCheckTime(timestamp) {
  try {
    fs.writeFileSync(LAST_CHECK_FILE, timestamp);
    log(`💾 Saved checkpoint: ${timestamp}`);
  } catch (error) {
    log(`❌ Failed to save checkpoint: ${error.message}`);
  }
}

async function fetchNewCallResults(db, lastCheck) {
  const [calls] = await db.execute(`
    SELECT
      uniqueid,
      lead_id,
      list_id,
      campaign_id,
      call_date,
      start_epoch,
      end_epoch,
      length_in_sec,
      status,
      phone_code,
      phone_number,
      user,
      comments,
      processed,
      user_group,
      term_reason,
      alt_dial,
      called_count
    FROM vicidial_log
    WHERE end_epoch > UNIX_TIMESTAMP(?)
      AND status != ''
      AND status IS NOT NULL
      AND length_in_sec > 0
    ORDER BY end_epoch ASC
    LIMIT ?
  `, [lastCheck, BATCH_SIZE]);

  return calls;
}

async function sendCallResultToAPI(call) {
  const payload = {
    uniqueid: call.uniqueid,
    leadId: call.lead_id,
    listId: call.list_id,
    campaignId: call.campaign_id,
    phoneNumber: call.phone_number,
    phoneCode: call.phone_code,
    disposition: call.status,
    duration: call.length_in_sec,
    agentId: call.user,
    userGroup: call.user_group,
    termReason: call.term_reason,
    comments: call.comments,
    altDial: call.alt_dial,
    calledCount: call.called_count,
    callDate: call.call_date,
    startEpoch: call.start_epoch,
    endEpoch: call.end_epoch,
    timestamp: call.end_epoch
  };

  const response = await axios.post(
    `${API_URL}/api/v1/call-results`,
    payload,
    {
      headers: {
        'x-api-key': API_KEY,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    }
  );

  return response.data;
}

async function processCallResults() {
  const startTime = Date.now();
  log('🚀 Starting call results sync...');

  let db;
  try {
    // Connect to VICIdial database
    db = await mysql.createConnection(VICIDIAL_DB_CONFIG);
    log('✅ Connected to VICIdial database');

    // Get last check time
    const lastCheck = await getLastCheckTime();

    // Fetch new call results
    const calls = await fetchNewCallResults(db, lastCheck);
    log(`📞 Found ${calls.length} new call results`);

    if (calls.length === 0) {
      log('✓ No new calls to process');
      return;
    }

    // Process each call
    let processed = 0;
    let failed = 0;
    let latestEndEpoch = 0;

    for (const call of calls) {
      try {
        await sendCallResultToAPI(call);
        processed++;

        // Track latest end_epoch
        if (call.end_epoch > latestEndEpoch) {
          latestEndEpoch = call.end_epoch;
        }

        log(`✓ ${call.uniqueid}: ${call.campaign_id}/${call.phone_number} → ${call.status} (${call.length_in_sec}s)`);
      } catch (error) {
        failed++;
        log(`✗ ${call.uniqueid}: ${error.response?.data?.error || error.message}`);
      }
    }

    // Update checkpoint to latest processed call
    if (latestEndEpoch > 0) {
      const checkpointTime = new Date(latestEndEpoch * 1000)
        .toISOString()
        .slice(0, 19)
        .replace('T', ' ');
      saveLastCheckTime(checkpointTime);
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    log(`📊 Summary: ${processed} processed, ${failed} failed in ${duration}s`);

    if (calls.length === BATCH_SIZE) {
      log(`⚠️  Batch limit reached (${BATCH_SIZE}). More calls may be pending.`);
    }

  } catch (error) {
    log(`❌ Fatal error: ${error.message}`);
    if (error.code === 'ECONNREFUSED') {
      log('❌ Cannot connect to VICIdial database. Check credentials and connection.');
    }
    throw error;
  } finally {
    if (db) {
      await db.end();
      log('🔌 Database connection closed');
    }
  }
}

// Run the processor
processCallResults()
  .then(() => {
    log('✅ Sync completed successfully\n');
    process.exit(0);
  })
  .catch((error) => {
    log(`❌ Sync failed: ${error.message}\n`);
    process.exit(1);
  });
