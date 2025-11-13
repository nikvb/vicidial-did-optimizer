#!/usr/bin/env node

/**
 * Multi-threaded Stress Testing Tool for /api/v1/dids/next endpoint
 *
 * Features:
 * - Concurrent request simulation with worker threads
 * - Real-time performance metrics
 * - Configurable load patterns
 * - Detailed statistics and reporting
 *
 * Usage:
 *   node stress-test-dids-next.js --threads 50 --requests 1000 --duration 60
 *   node stress-test-dids-next.js --rps 100 --duration 30
 */

import { Worker } from 'worker_threads';
import { URL } from 'url';
import { performance } from 'perf_hooks';
import fs from 'fs';

// Configuration
const config = {
  apiUrl: process.env.API_URL || 'http://localhost:5000/api/v1/dids/next',
  apiKey: process.env.API_KEY || 'did_259b3759b3041137f2379fe1aff4aefeba4aa8b8bea355c4f0e33fbe714d46f7',

  // Test parameters (can be overridden by CLI args)
  threads: 10,          // Number of concurrent worker threads
  requestsPerThread: 100, // Total requests per thread
  duration: 0,          // Test duration in seconds (0 = use requestsPerThread instead)
  rampUp: 5,            // Ramp up time in seconds
  requestsPerSecond: 0, // Target RPS (0 = no throttling)

  // Request parameters
  campaignIds: ['CAMPAIGN001', 'CAMPAIGN002', 'CAMPAIGN003'],
  agentIds: Array.from({ length: 20 }, (_, i) => `agent${1001 + i}`),
  customerPhones: Array.from({ length: 100 }, () =>
    `555${Math.floor(Math.random() * 1000000).toString().padStart(7, '0')}`
  ),
  customerStates: ['CA', 'NY', 'TX', 'FL', 'IL', 'PA', 'OH', 'GA', 'NC', 'MI'],

  // Output
  verbose: false,
  reportFile: 'stress-test-report.json'
};

// Parse CLI arguments
function parseArgs() {
  const args = process.argv.slice(2);

  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace(/^--/, '');
    const value = args[i + 1];

    if (key === 'threads') config.threads = parseInt(value);
    else if (key === 'requests') config.requestsPerThread = parseInt(value);
    else if (key === 'duration') config.duration = parseInt(value);
    else if (key === 'rps') config.requestsPerSecond = parseInt(value);
    else if (key === 'rampup') config.rampUp = parseInt(value);
    else if (key === 'verbose') config.verbose = true;
    else if (key === 'api-key') config.apiKey = value;
    else if (key === 'api-url') config.apiUrl = value;
    else if (key === 'report') config.reportFile = value;
  }
}

// Statistics aggregator
class StatsAggregator {
  constructor() {
    this.reset();
  }

  reset() {
    this.totalRequests = 0;
    this.successfulRequests = 0;
    this.failedRequests = 0;
    this.responseTimes = [];
    this.errors = {};
    this.statusCodes = {};
    this.startTime = null;
    this.endTime = null;
    this.throughput = [];
    this.currentRPS = 0;
  }

  recordRequest(success, responseTime, statusCode, error) {
    this.totalRequests++;

    if (success) {
      this.successfulRequests++;
    } else {
      this.failedRequests++;
      const errorKey = error || 'Unknown error';
      this.errors[errorKey] = (this.errors[errorKey] || 0) + 1;
    }

    if (responseTime) {
      this.responseTimes.push(responseTime);
    }

    if (statusCode) {
      this.statusCodes[statusCode] = (this.statusCodes[statusCode] || 0) + 1;
    }
  }

  recordThroughput(rps) {
    this.throughput.push({ timestamp: Date.now(), rps });
    this.currentRPS = rps;
  }

  getPercentile(percentile) {
    if (this.responseTimes.length === 0) return 0;

    const sorted = [...this.responseTimes].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  getStats() {
    const duration = this.endTime ? (this.endTime - this.startTime) / 1000 : 0;
    const avgResponseTime = this.responseTimes.length > 0
      ? this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length
      : 0;

    return {
      summary: {
        totalRequests: this.totalRequests,
        successful: this.successfulRequests,
        failed: this.failedRequests,
        successRate: ((this.successfulRequests / this.totalRequests) * 100).toFixed(2) + '%',
        duration: duration.toFixed(2) + 's',
        actualRPS: duration > 0 ? (this.totalRequests / duration).toFixed(2) : 0
      },
      responseTimes: {
        min: Math.min(...this.responseTimes).toFixed(2) + 'ms',
        max: Math.max(...this.responseTimes).toFixed(2) + 'ms',
        avg: avgResponseTime.toFixed(2) + 'ms',
        p50: this.getPercentile(50).toFixed(2) + 'ms',
        p90: this.getPercentile(90).toFixed(2) + 'ms',
        p95: this.getPercentile(95).toFixed(2) + 'ms',
        p99: this.getPercentile(99).toFixed(2) + 'ms'
      },
      statusCodes: this.statusCodes,
      errors: this.errors,
      throughput: {
        current: this.currentRPS,
        average: duration > 0 ? (this.totalRequests / duration).toFixed(2) : 0,
        peak: Math.max(...this.throughput.map(t => t.rps))
      }
    };
  }

  printLiveStats() {
    const stats = this.getStats();

    console.clear();
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  🚀 DID API Stress Test - Live Statistics');
    console.log('═══════════════════════════════════════════════════════════\n');

    console.log('📊 Summary:');
    console.log(`   Total Requests:    ${stats.summary.totalRequests}`);
    console.log(`   ✅ Successful:     ${stats.summary.successful}`);
    console.log(`   ❌ Failed:         ${stats.summary.failed}`);
    console.log(`   Success Rate:      ${stats.summary.successRate}`);
    console.log(`   Actual RPS:        ${stats.summary.actualRPS}`);
    console.log(`   Duration:          ${stats.summary.duration}`);

    console.log('\n⚡ Response Times:');
    console.log(`   Min:               ${stats.responseTimes.min}`);
    console.log(`   Max:               ${stats.responseTimes.max}`);
    console.log(`   Average:           ${stats.responseTimes.avg}`);
    console.log(`   P50 (Median):      ${stats.responseTimes.p50}`);
    console.log(`   P90:               ${stats.responseTimes.p90}`);
    console.log(`   P95:               ${stats.responseTimes.p95}`);
    console.log(`   P99:               ${stats.responseTimes.p99}`);

    if (Object.keys(stats.statusCodes).length > 0) {
      console.log('\n📈 Status Codes:');
      Object.entries(stats.statusCodes).forEach(([code, count]) => {
        console.log(`   ${code}: ${count}`);
      });
    }

    if (Object.keys(stats.errors).length > 0) {
      console.log('\n❗ Errors:');
      Object.entries(stats.errors).slice(0, 5).forEach(([error, count]) => {
        const errorMsg = error.length > 50 ? error.substring(0, 47) + '...' : error;
        console.log(`   ${count}x ${errorMsg}`);
      });
    }

    console.log('\n═══════════════════════════════════════════════════════════\n');
  }
}

// Worker thread code
const workerCode = `
const { parentPort, workerData } = require('worker_threads');
const https = require('https');
const http = require('http');

async function makeRequest() {
  const { apiUrl, apiKey, campaignId, agentId, customerPhone, customerState } = workerData;

  const url = new URL(apiUrl);
  url.searchParams.append('campaign_id', campaignId);
  url.searchParams.append('agent_id', agentId);
  url.searchParams.append('customer_phone', customerPhone);
  url.searchParams.append('customer_state', customerState);

  const options = {
    method: 'GET',
    headers: {
      'x-api-key': apiKey,
      'User-Agent': 'DID-Stress-Test/1.0'
    }
  };

  const protocol = url.protocol === 'https:' ? https : http;
  const startTime = Date.now();

  return new Promise((resolve) => {
    const req = protocol.request(url, options, (res) => {
      let data = '';

      res.on('data', chunk => data += chunk);

      res.on('end', () => {
        const responseTime = Date.now() - startTime;

        resolve({
          success: res.statusCode >= 200 && res.statusCode < 300,
          responseTime,
          statusCode: res.statusCode,
          error: res.statusCode >= 400 ? \`HTTP \${res.statusCode}\` : null
        });
      });
    });

    req.on('error', (error) => {
      const responseTime = Date.now() - startTime;
      resolve({
        success: false,
        responseTime,
        statusCode: 0,
        error: error.message
      });
    });

    req.setTimeout(30000, () => {
      req.destroy();
      resolve({
        success: false,
        responseTime: 30000,
        statusCode: 0,
        error: 'Request timeout (30s)'
      });
    });

    req.end();
  });
}

async function runWorker() {
  const { requestCount, delay } = workerData;

  for (let i = 0; i < requestCount; i++) {
    // Randomize request parameters
    workerData.campaignId = workerData.campaignIds[Math.floor(Math.random() * workerData.campaignIds.length)];
    workerData.agentId = workerData.agentIds[Math.floor(Math.random() * workerData.agentIds.length)];
    workerData.customerPhone = workerData.customerPhones[Math.floor(Math.random() * workerData.customerPhones.length)];
    workerData.customerState = workerData.customerStates[Math.floor(Math.random() * workerData.customerStates.length)];

    const result = await makeRequest();
    parentPort.postMessage(result);

    if (delay > 0 && i < requestCount - 1) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  parentPort.postMessage({ done: true });
}

runWorker().catch(error => {
  parentPort.postMessage({
    success: false,
    responseTime: 0,
    statusCode: 0,
    error: error.message
  });
});
`;

// Main stress test orchestrator
async function runStressTest() {
  parseArgs();

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  🚀 DID API Multi-threaded Stress Test');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('📋 Configuration:');
  console.log(`   API URL:           ${config.apiUrl}`);
  console.log(`   Worker Threads:    ${config.threads}`);
  console.log(`   Requests/Thread:   ${config.requestsPerThread}`);
  console.log(`   Total Requests:    ${config.threads * config.requestsPerThread}`);
  console.log(`   Ramp-up Time:      ${config.rampUp}s`);
  if (config.requestsPerSecond > 0) {
    console.log(`   Target RPS:        ${config.requestsPerSecond}`);
  }
  if (config.duration > 0) {
    console.log(`   Duration:          ${config.duration}s`);
  }
  console.log('');

  const stats = new StatsAggregator();
  stats.startTime = performance.now();

  // Calculate delay between requests for rate limiting
  const delay = config.requestsPerSecond > 0
    ? Math.floor((1000 * config.threads) / config.requestsPerSecond)
    : 0;

  // Create worker thread script file
  const workerFile = '/tmp/stress-test-worker.cjs';
  fs.writeFileSync(workerFile, workerCode);

  // Launch workers with ramp-up
  const workers = [];
  const rampUpDelay = (config.rampUp * 1000) / config.threads;

  console.log('🚀 Starting workers...\n');

  for (let i = 0; i < config.threads; i++) {
    await new Promise(resolve => setTimeout(resolve, rampUpDelay));

    const worker = new Worker(workerFile, {
      workerData: {
        apiUrl: config.apiUrl,
        apiKey: config.apiKey,
        requestCount: config.requestsPerThread,
        delay,
        campaignIds: config.campaignIds,
        agentIds: config.agentIds,
        customerPhones: config.customerPhones,
        customerStates: config.customerStates
      }
    });

    worker.on('message', (result) => {
      if (result.done) {
        worker.terminate();
        return;
      }

      stats.recordRequest(
        result.success,
        result.responseTime,
        result.statusCode,
        result.error
      );
    });

    worker.on('error', (error) => {
      console.error(`Worker ${i} error:`, error);
      stats.recordRequest(false, 0, 0, error.message);
    });

    workers.push(worker);
  }

  // Live stats updater
  const statsInterval = setInterval(() => {
    stats.printLiveStats();
  }, 1000);

  // RPS calculator
  let lastRequestCount = 0;
  const rpsInterval = setInterval(() => {
    const currentCount = stats.totalRequests;
    const rps = currentCount - lastRequestCount;
    stats.recordThroughput(rps);
    lastRequestCount = currentCount;
  }, 1000);

  // Wait for all workers to complete
  await Promise.all(workers.map(w => new Promise((resolve) => {
    w.on('exit', resolve);
  })));

  clearInterval(statsInterval);
  clearInterval(rpsInterval);

  stats.endTime = performance.now();

  // Final report
  console.clear();
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  ✅ Stress Test Complete - Final Report');
  console.log('═══════════════════════════════════════════════════════════\n');

  const finalStats = stats.getStats();

  console.log('📊 Summary:');
  console.log(`   Total Requests:    ${finalStats.summary.totalRequests}`);
  console.log(`   ✅ Successful:     ${finalStats.summary.successful}`);
  console.log(`   ❌ Failed:         ${finalStats.summary.failed}`);
  console.log(`   Success Rate:      ${finalStats.summary.successRate}`);
  console.log(`   Actual RPS:        ${finalStats.summary.actualRPS}`);
  console.log(`   Duration:          ${finalStats.summary.duration}`);

  console.log('\n⚡ Response Times:');
  console.log(`   Min:               ${finalStats.responseTimes.min}`);
  console.log(`   Max:               ${finalStats.responseTimes.max}`);
  console.log(`   Average:           ${finalStats.responseTimes.avg}`);
  console.log(`   P50 (Median):      ${finalStats.responseTimes.p50}`);
  console.log(`   P90:               ${finalStats.responseTimes.p90}`);
  console.log(`   P95:               ${finalStats.responseTimes.p95}`);
  console.log(`   P99:               ${finalStats.responseTimes.p99}`);

  console.log('\n📈 Status Codes:');
  Object.entries(finalStats.statusCodes).forEach(([code, count]) => {
    const percentage = ((count / stats.totalRequests) * 100).toFixed(1);
    console.log(`   ${code}: ${count} (${percentage}%)`);
  });

  if (Object.keys(finalStats.errors).length > 0) {
    console.log('\n❗ Errors:');
    Object.entries(finalStats.errors).forEach(([error, count]) => {
      console.log(`   ${count}x ${error}`);
    });
  }

  console.log('\n🎯 Performance Analysis:');
  const avgResponseTime = parseFloat(finalStats.responseTimes.avg);
  const p99ResponseTime = parseFloat(finalStats.responseTimes.p99);

  if (avgResponseTime < 100) {
    console.log('   ✅ Excellent: Average response time < 100ms');
  } else if (avgResponseTime < 200) {
    console.log('   ✅ Good: Average response time < 200ms');
  } else if (avgResponseTime < 500) {
    console.log('   ⚠️  Fair: Average response time < 500ms');
  } else {
    console.log('   ❌ Poor: Average response time > 500ms');
  }

  if (p99ResponseTime < 500) {
    console.log('   ✅ P99 latency < 500ms (good tail latency)');
  } else {
    console.log('   ⚠️  P99 latency > 500ms (high tail latency)');
  }

  const successRate = parseFloat(finalStats.summary.successRate);
  if (successRate >= 99.9) {
    console.log('   ✅ Success rate >= 99.9% (excellent reliability)');
  } else if (successRate >= 99) {
    console.log('   ✅ Success rate >= 99% (good reliability)');
  } else if (successRate >= 95) {
    console.log('   ⚠️  Success rate >= 95% (acceptable)');
  } else {
    console.log('   ❌ Success rate < 95% (poor reliability)');
  }

  console.log('\n═══════════════════════════════════════════════════════════\n');

  // Save report to file
  const report = {
    config: {
      apiUrl: config.apiUrl,
      threads: config.threads,
      requestsPerThread: config.requestsPerThread,
      totalRequests: config.threads * config.requestsPerThread,
      targetRPS: config.requestsPerSecond,
      rampUpTime: config.rampUp
    },
    results: finalStats,
    timestamp: new Date().toISOString(),
    rawResponseTimes: stats.responseTimes.slice(0, 10000) // Limit to prevent huge files
  };

  fs.writeFileSync(config.reportFile, JSON.stringify(report, null, 2));
  console.log(`📄 Full report saved to: ${config.reportFile}\n`);

  // Cleanup
  try {
    fs.unlinkSync(workerFile);
  } catch (e) {
    // Ignore cleanup errors
  }
}

// Run the stress test
runStressTest().catch(error => {
  console.error('❌ Stress test failed:', error);
  process.exit(1);
});
