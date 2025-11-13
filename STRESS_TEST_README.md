# DID API Stress Testing Tools

Comprehensive multi-threaded stress testing tools for the `/api/v1/dids/next` endpoint.

## Available Tools

### 1. stress-test-dids-next.js (Multi-threaded)
Full-featured stress testing with worker threads for maximum concurrency and accurate load simulation.

**Features:**
- ✅ True multi-threading using Node.js worker_threads
- ✅ Real-time live statistics dashboard
- ✅ Configurable ramp-up period
- ✅ Request rate throttling (RPS limiting)
- ✅ Detailed percentile latency analysis (P50, P90, P95, P99)
- ✅ Throughput tracking and peak RPS detection
- ✅ Comprehensive error reporting
- ✅ JSON report generation

### 2. stress-test-simple.js (Concurrent Promises)
Lightweight alternative using concurrent async requests without worker threads.

**Features:**
- ✅ Simpler architecture (no worker threads)
- ✅ Lower overhead
- ✅ Progress tracking
- ✅ Percentile latency analysis
- ✅ JSON report generation
- ✅ Good for moderate load testing

## Installation

No additional dependencies required! Both tools use only Node.js built-in modules.

```bash
chmod +x stress-test-dids-next.js
chmod +x stress-test-simple.js
```

## Usage Examples

### Quick Start (Simple Tool)

```bash
# Basic test: 50 concurrent requests, 1000 total
node stress-test-simple.js --concurrent 50 --requests 1000

# Custom API URL and key
node stress-test-simple.js \
  --concurrent 100 \
  --requests 5000 \
  --api-url http://localhost:5000/api/v1/dids/next \
  --api-key your_api_key_here
```

### Advanced (Multi-threaded Tool)

```bash
# 100 worker threads, 100 requests per thread (10,000 total)
node stress-test-dids-next.js --threads 100 --requests 100

# Target 500 requests per second for 60 seconds
node stress-test-dids-next.js --rps 500 --duration 60 --threads 50

# Gradual ramp-up: 50 threads over 10 seconds
node stress-test-dids-next.js --threads 50 --requests 200 --rampup 10

# High load test
node stress-test-dids-next.js --threads 200 --requests 50 --rps 1000
```

## Command Line Options

### stress-test-dids-next.js (Multi-threaded)

| Option | Description | Default |
|--------|-------------|---------|
| `--threads` | Number of worker threads | 10 |
| `--requests` | Requests per thread | 100 |
| `--duration` | Test duration in seconds (overrides requests) | 0 (disabled) |
| `--rps` | Target requests per second (0 = unlimited) | 0 |
| `--rampup` | Ramp-up time in seconds | 5 |
| `--api-url` | API endpoint URL | http://localhost:5000/api/v1/dids/next |
| `--api-key` | API key for authentication | (from env or default) |
| `--report` | Output report file | stress-test-report.json |
| `--verbose` | Enable verbose logging | false |

### stress-test-simple.js (Concurrent)

| Option | Description | Default |
|--------|-------------|---------|
| `--concurrent` | Number of concurrent requests | 20 |
| `--requests` | Total number of requests | 100 |
| `--timeout` | Request timeout in ms | 30000 |
| `--api-url` | API endpoint URL | http://localhost:5000/api/v1/dids/next |
| `--api-key` | API key for authentication | (from env or default) |
| `--report` | Output report file | stress-test-simple-report.json |

## Environment Variables

```bash
# Set API configuration via environment
export API_URL="http://localhost:5000/api/v1/dids/next"
export API_KEY="did_259b3759b3041137f2379fe1aff4aefeba4aa8b8bea355c4f0e33fbe714d46f7"

# Run test
node stress-test-dids-next.js --threads 50 --requests 100
```

## Test Scenarios

### 1. Baseline Performance Test
Establish baseline metrics with moderate load:

```bash
node stress-test-simple.js --concurrent 20 --requests 500
```

**Expected Results:**
- Success Rate: > 99%
- Average Response Time: < 200ms
- P99 Latency: < 500ms

### 2. Load Test (High Volume)
Test sustained high load:

```bash
node stress-test-dids-next.js --threads 100 --requests 100 --rampup 10
```

**Target Metrics:**
- Total Requests: 10,000
- Duration: ~60-90 seconds
- Success Rate: > 95%

### 3. Spike Test
Test sudden traffic spike:

```bash
node stress-test-dids-next.js --threads 200 --requests 50 --rampup 1
```

**Measures:**
- Server resilience to sudden load
- Error rate under pressure
- Recovery time

### 4. Endurance Test
Test for memory leaks and performance degradation:

```bash
node stress-test-dids-next.js --duration 300 --threads 50 --rps 100
```

**Monitors:**
- Response time stability over time
- Memory usage patterns
- Connection pool behavior

### 5. Capacity Test (Find Breaking Point)
Determine maximum sustainable load:

```bash
# Start conservatively
node stress-test-dids-next.js --threads 50 --requests 200

# Increase load gradually
node stress-test-dids-next.js --threads 100 --requests 200
node stress-test-dids-next.js --threads 200 --requests 200
node stress-test-dids-next.js --threads 500 --requests 100

# Monitor when success rate drops below 95% or P99 > 1000ms
```

## Output Examples

### Live Statistics (Multi-threaded Tool)

```
═══════════════════════════════════════════════════════════
  🚀 DID API Stress Test - Live Statistics
═══════════════════════════════════════════════════════════

📊 Summary:
   Total Requests:    4,523
   ✅ Successful:     4,518
   ❌ Failed:         5
   Success Rate:      99.89%
   Actual RPS:        150.77
   Duration:          30.02s

⚡ Response Times:
   Min:               45.23ms
   Max:               892.15ms
   Average:           123.45ms
   P50 (Median):      98.76ms
   P90:               245.32ms
   P95:               321.09ms
   P99:               567.23ms

📈 Status Codes:
   200: 4518
   500: 5

═══════════════════════════════════════════════════════════
```

### Simple Tool Progress

```
🚀 Progress: 842/1000 (84.2%) | ✅ 835 | ❌ 7 | ETA: 12s
```

## Report Files

Both tools generate JSON reports with detailed statistics:

```json
{
  "config": {
    "apiUrl": "http://localhost:5000/api/v1/dids/next",
    "threads": 50,
    "requestsPerThread": 100,
    "totalRequests": 5000
  },
  "results": {
    "summary": {
      "totalRequests": 5000,
      "successful": 4987,
      "failed": 13,
      "successRate": "99.74%",
      "duration": "42.35s",
      "actualRPS": "118.06"
    },
    "responseTimes": {
      "min": "42.18ms",
      "max": "1245.67ms",
      "avg": "145.23ms",
      "p50": "112.45ms",
      "p90": "287.34ms",
      "p95": "423.12ms",
      "p99": "789.45ms"
    }
  },
  "timestamp": "2025-11-13T22:15:30.123Z"
}
```

## Performance Analysis

### Interpreting Results

#### ✅ Excellent Performance
- Success Rate: > 99.9%
- Average Response Time: < 100ms
- P99 Latency: < 300ms

#### ✅ Good Performance
- Success Rate: > 99%
- Average Response Time: < 200ms
- P99 Latency: < 500ms

#### ⚠️ Fair Performance
- Success Rate: > 95%
- Average Response Time: < 500ms
- P99 Latency: < 1000ms

#### ❌ Poor Performance
- Success Rate: < 95%
- Average Response Time: > 500ms
- P99 Latency: > 1000ms

### Key Metrics to Monitor

1. **Success Rate**: Should stay above 99% under normal load
2. **P99 Latency**: Most important for user experience (tail latency)
3. **Throughput (RPS)**: Actual vs. target requests per second
4. **Error Types**: HTTP 500 indicates server errors, timeouts indicate overload

## Troubleshooting

### Issue: High Failure Rate

**Symptoms:** Success rate < 95%

**Possible Causes:**
- Server overload (reduce threads/RPS)
- Database connection pool exhausted
- API rate limiting

**Solution:**
```bash
# Reduce load
node stress-test-dids-next.js --threads 20 --requests 50

# Check server logs
pm2 logs did-api --lines 100
```

### Issue: High Latency (P99 > 1000ms)

**Symptoms:** P99 latency exceeds 1 second

**Possible Causes:**
- Missing database indexes
- Inefficient queries
- GC pauses

**Solution:**
```bash
# Check MongoDB indexes
mongosh did-optimizer --eval "db.dids.getIndexes()"

# Monitor server performance
pm2 monit
```

### Issue: Worker Thread Errors

**Symptoms:** "Worker failed" messages

**Possible Causes:**
- Memory limits
- OS thread limits

**Solution:**
```bash
# Reduce thread count
node stress-test-dids-next.js --threads 10 --requests 500

# Use simple tool instead
node stress-test-simple.js --concurrent 50 --requests 5000
```

## Best Practices

1. **Start Small**: Begin with low load and increase gradually
2. **Monitor Server**: Keep `pm2 logs` or `pm2 monit` open during tests
3. **Warm Up**: Run a small test first to warm up caches
4. **Clean State**: Restart server between major tests for consistent results
5. **Realistic Load**: Match test patterns to expected production traffic
6. **Document Results**: Save reports and note any changes between tests

## Comparing Before/After Optimization

### Before Database Indexes

```bash
node stress-test-simple.js --concurrent 50 --requests 1000
```

Expected baseline:
- Average: ~300-500ms
- P99: ~800-1200ms
- Some failures under load

### After Database Indexes

```bash
node stress-test-simple.js --concurrent 50 --requests 1000
```

Expected improvement:
- Average: ~80-150ms (50-70% faster)
- P99: ~200-400ms (60-70% faster)
- < 1% failures

## Advanced Usage

### Custom Request Parameters

Edit the script to customize test data:

```javascript
const campaignIds = ['CAMPAIGN001', 'CAMPAIGN002'];  // Your campaigns
const agentIds = ['agent1001', 'agent1002'];        // Your agents
```

### Monitoring During Test

```bash
# Terminal 1: Run stress test
node stress-test-dids-next.js --threads 100 --requests 100

# Terminal 2: Monitor server
pm2 logs did-api

# Terminal 3: Monitor database
mongosh did-optimizer --eval "db.currentOp()"

# Terminal 4: Monitor system
htop  # or top
```

## Safety Notes

⚠️ **Warning:** High-load stress tests can:
- Consume significant server resources
- Impact production traffic if run on live servers
- Generate large amounts of test data

**Recommendations:**
- Run on development/staging environments
- Start with conservative load levels
- Monitor resource usage during tests
- Clean up test data after completion

## Support

For issues or questions:
1. Check `stress-test-report.json` for detailed error information
2. Review server logs: `pm2 logs did-api`
3. Check MongoDB slow query log
4. Verify database indexes are built
5. See `OPTIMIZATION_SUMMARY.md` for optimization details
