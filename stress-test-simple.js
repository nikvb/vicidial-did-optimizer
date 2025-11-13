#!/usr/bin/env node

/**
 * Simple Concurrent Stress Testing Tool (no worker threads)
 *
 * Lighter weight alternative using Promise.all() for concurrent requests
 *
 * Usage:
 *   node stress-test-simple.js --concurrent 50 --requests 1000
 */

import https from 'https';
import http from 'http';
import { URL } from 'url';
import { performance } from 'perf_hooks';
import fs from 'fs';

// Create HTTP agents with unlimited sockets for high concurrency
const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: Infinity,
  maxFreeSockets: 256,
  timeout: 30000
});

const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: Infinity,
  maxFreeSockets: 256,
  timeout: 30000
});

const config = {
  apiUrl: process.env.API_URL || 'http://localhost:5000/api/v1/dids/next',
  apiKey: process.env.API_KEY || 'did_259b3759b3041137f2379fe1aff4aefeba4aa8b8bea355c4f0e33fbe714d46f7',
  concurrent: 20,
  totalRequests: 100,
  timeout: 30000,
  reportFile: 'stress-test-simple-report.json'
};

// Parse CLI args
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 2) {
  const key = args[i].replace(/^--/, '');
  const value = args[i + 1];
  if (key === 'concurrent') config.concurrent = parseInt(value);
  else if (key === 'requests') config.totalRequests = parseInt(value);
  else if (key === 'timeout') config.timeout = parseInt(value);
  else if (key === 'api-key') config.apiKey = value;
  else if (key === 'api-url') config.apiUrl = value;
  else if (key === 'report') config.reportFile = value;
}

const stats = {
  total: 0,
  successful: 0,
  failed: 0,
  responseTimes: [],
  errors: {},
  statusCodes: {},
  startTime: 0,
  endTime: 0
};

const campaignIds = ['CAMPAIGN001', 'CAMPAIGN002', 'CAMPAIGN003'];
const agentIds = Array.from({ length: 20 }, (_, i) => `agent${1001 + i}`);
const customerPhones = Array.from({ length: 100 }, () =>
  `555${Math.floor(Math.random() * 1000000).toString().padStart(7, '0')}`
);
const customerStates = ['CA', 'NY', 'TX', 'FL', 'IL'];

async function makeRequest() {
  const campaignId = campaignIds[Math.floor(Math.random() * campaignIds.length)];
  const agentId = agentIds[Math.floor(Math.random() * agentIds.length)];
  const customerPhone = customerPhones[Math.floor(Math.random() * customerPhones.length)];
  const customerState = customerStates[Math.floor(Math.random() * customerStates.length)];

  const url = new URL(config.apiUrl);
  url.searchParams.append('campaign_id', campaignId);
  url.searchParams.append('agent_id', agentId);
  url.searchParams.append('customer_phone', customerPhone);
  url.searchParams.append('customer_state', customerState);

  const isHttps = url.protocol === 'https:';

  const options = {
    method: 'GET',
    headers: {
      'x-api-key': config.apiKey,
      'User-Agent': 'DID-Stress-Test-Simple/1.0'
    },
    timeout: config.timeout,
    agent: isHttps ? httpsAgent : httpAgent
  };

  const protocol = isHttps ? https : http;
  const startTime = performance.now();

  return new Promise((resolve) => {
    const req = protocol.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const responseTime = performance.now() - startTime;
        const success = res.statusCode >= 200 && res.statusCode < 300;

        stats.total++;
        if (success) {
          stats.successful++;
        } else {
          stats.failed++;
          const errorKey = `HTTP ${res.statusCode}`;
          stats.errors[errorKey] = (stats.errors[errorKey] || 0) + 1;
        }

        stats.responseTimes.push(responseTime);
        stats.statusCodes[res.statusCode] = (stats.statusCodes[res.statusCode] || 0) + 1;

        resolve({ success, responseTime, statusCode: res.statusCode });
      });
    });

    req.on('error', (error) => {
      const responseTime = performance.now() - startTime;
      stats.total++;
      stats.failed++;
      stats.errors[error.message] = (stats.errors[error.message] || 0) + 1;
      stats.responseTimes.push(responseTime);
      resolve({ success: false, responseTime, error: error.message });
    });

    req.setTimeout(config.timeout, () => {
      req.destroy();
      stats.total++;
      stats.failed++;
      stats.errors['Timeout'] = (stats.errors['Timeout'] || 0) + 1;
      resolve({ success: false, responseTime: config.timeout, error: 'Timeout' });
    });

    req.end();
  });
}

function getPercentile(arr, percentile) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

function printProgress() {
  const progress = ((stats.total / config.totalRequests) * 100).toFixed(1);
  const eta = stats.total > 0
    ? ((config.totalRequests - stats.total) * (Date.now() - stats.startTime) / stats.total / 1000).toFixed(0)
    : 0;

  process.stdout.write(`\r🚀 Progress: ${stats.total}/${config.totalRequests} (${progress}%) | ` +
    `✅ ${stats.successful} | ❌ ${stats.failed} | ETA: ${eta}s    `);
}

async function runStressTest() {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  🚀 DID API Simple Stress Test');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('📋 Configuration:');
  console.log(`   API URL:           ${config.apiUrl}`);
  console.log(`   Concurrent:        ${config.concurrent}`);
  console.log(`   Total Requests:    ${config.totalRequests}`);
  console.log(`   Timeout:           ${config.timeout}ms`);
  console.log('');

  stats.startTime = Date.now();

  // Progress updater
  const progressInterval = setInterval(printProgress, 500);

  // Run requests in batches
  const batches = Math.ceil(config.totalRequests / config.concurrent);

  for (let batch = 0; batch < batches; batch++) {
    const batchSize = Math.min(config.concurrent, config.totalRequests - stats.total);
    const promises = Array.from({ length: batchSize }, () => makeRequest());
    await Promise.all(promises);
  }

  clearInterval(progressInterval);
  stats.endTime = Date.now();

  // Final report
  console.log('\n\n═══════════════════════════════════════════════════════════');
  console.log('  ✅ Stress Test Complete - Final Report');
  console.log('═══════════════════════════════════════════════════════════\n');

  const duration = (stats.endTime - stats.startTime) / 1000;
  const avgResponseTime = stats.responseTimes.reduce((a, b) => a + b, 0) / stats.responseTimes.length;

  console.log('📊 Summary:');
  console.log(`   Total Requests:    ${stats.total}`);
  console.log(`   ✅ Successful:     ${stats.successful}`);
  console.log(`   ❌ Failed:         ${stats.failed}`);
  console.log(`   Success Rate:      ${((stats.successful / stats.total) * 100).toFixed(2)}%`);
  console.log(`   Actual RPS:        ${(stats.total / duration).toFixed(2)}`);
  console.log(`   Duration:          ${duration.toFixed(2)}s`);

  console.log('\n⚡ Response Times:');
  console.log(`   Min:               ${Math.min(...stats.responseTimes).toFixed(2)}ms`);
  console.log(`   Max:               ${Math.max(...stats.responseTimes).toFixed(2)}ms`);
  console.log(`   Average:           ${avgResponseTime.toFixed(2)}ms`);
  console.log(`   P50 (Median):      ${getPercentile(stats.responseTimes, 50).toFixed(2)}ms`);
  console.log(`   P90:               ${getPercentile(stats.responseTimes, 90).toFixed(2)}ms`);
  console.log(`   P95:               ${getPercentile(stats.responseTimes, 95).toFixed(2)}ms`);
  console.log(`   P99:               ${getPercentile(stats.responseTimes, 99).toFixed(2)}ms`);

  console.log('\n📈 Status Codes:');
  Object.entries(stats.statusCodes).forEach(([code, count]) => {
    const percentage = ((count / stats.total) * 100).toFixed(1);
    console.log(`   ${code}: ${count} (${percentage}%)`);
  });

  if (Object.keys(stats.errors).length > 0) {
    console.log('\n❗ Errors:');
    Object.entries(stats.errors).forEach(([error, count]) => {
      console.log(`   ${count}x ${error}`);
    });
  }

  console.log('\n═══════════════════════════════════════════════════════════\n');

  // Save report
  const report = {
    config,
    results: {
      total: stats.total,
      successful: stats.successful,
      failed: stats.failed,
      successRate: ((stats.successful / stats.total) * 100).toFixed(2) + '%',
      duration: duration.toFixed(2) + 's',
      actualRPS: (stats.total / duration).toFixed(2),
      responseTimes: {
        min: Math.min(...stats.responseTimes),
        max: Math.max(...stats.responseTimes),
        avg: avgResponseTime,
        p50: getPercentile(stats.responseTimes, 50),
        p90: getPercentile(stats.responseTimes, 90),
        p95: getPercentile(stats.responseTimes, 95),
        p99: getPercentile(stats.responseTimes, 99)
      },
      statusCodes: stats.statusCodes,
      errors: stats.errors
    },
    timestamp: new Date().toISOString()
  };

  fs.writeFileSync(config.reportFile, JSON.stringify(report, null, 2));
  console.log(`📄 Full report saved to: ${config.reportFile}\n`);
}

runStressTest().catch(error => {
  console.error('❌ Stress test failed:', error);
  process.exit(1);
});
