# VICIdial Perl Stress Testing Tool - Quick Guide

## Overview

`stress-test-dids.pl` is a VICIdial-native stress testing tool that uses the **same Perl modules** as your production AGI scripts. This ensures the most realistic performance testing since it tests from the actual VICIdial environment.

## Why Use This Instead of Node.js Tools?

✅ **Same HTTP Client**: Uses `LWP::UserAgent` (same as `vicidial-did-optimizer.agi`)
✅ **No Extra Dependencies**: All modules already installed with VICIdial
✅ **Native to VICIdial**: Runs directly on your VICIdial server
✅ **Realistic Testing**: Tests exactly how production calls will behave
✅ **Easy Config Loading**: Can read from `/etc/asterisk/dids.conf`

## Installation (VICIdial Server)

```bash
# SSH to your VICIdial server
cd /usr/local/src

# Clone or copy the stress test script
wget https://raw.githubusercontent.com/nikvb/vicidial-did-optimizer/main/stress-test-dids.pl
chmod +x stress-test-dids.pl

# Or if you have the full repo:
cd /path/to/did-optimizer
chmod +x stress-test-dids.pl
```

## Basic Usage

### Load config from dids.conf (Recommended)

```bash
perl stress-test-dids.pl \
  --config /etc/asterisk/dids.conf \
  --concurrent 10 \
  --requests 100
```

This will:
- Load API URL and key from `/etc/asterisk/dids.conf`
- Run 10 concurrent requests at a time
- Make 100 total requests
- Show real-time progress
- Generate `stress-test-perl-report.json`

### Manual configuration

```bash
perl stress-test-dids.pl \
  --api-url http://YOUR_API_SERVER:5000/api/v1/dids/next \
  --api-key did_YOUR_API_KEY_HERE \
  --concurrent 20 \
  --requests 500
```

## Command Line Options

| Option | Description | Default |
|--------|-------------|---------|
| `--config FILE` | Load config from dids.conf | None |
| `--concurrent N` | Number of concurrent requests | 10 |
| `--requests N` | Total number of requests | 100 |
| `--timeout N` | Request timeout in seconds | 30 |
| `--api-url URL` | API endpoint URL | http://localhost:5000/api/v1/dids/next |
| `--api-key KEY` | API authentication key | (hardcoded default) |
| `--report FILE` | Output report filename | stress-test-perl-report.json |

## Test Scenarios

### Baseline Performance

Test with moderate load to establish baseline metrics:

```bash
perl stress-test-dids.pl \
  --config /etc/asterisk/dids.conf \
  --concurrent 10 \
  --requests 100
```

**Expected Good Results:**
- Success Rate: > 99%
- Average Response Time: < 200ms
- P99 Latency: < 500ms
- RPS: > 10

### Load Test

Test under higher sustained load:

```bash
perl stress-test-dids.pl \
  --config /etc/asterisk/dids.conf \
  --concurrent 50 \
  --requests 1000
```

**What to Watch:**
- Success rate should stay > 95%
- P99 latency should stay < 1000ms
- Server CPU and memory usage

### Quick Smoke Test

Fast verification after changes:

```bash
perl stress-test-dids.pl \
  --config /etc/asterisk/dids.conf \
  --concurrent 5 \
  --requests 25
```

## Understanding Output

### Real-Time Progress

```
🚀 Progress: 47/100 (47.0%) | ✅ 47 | ❌ 0 | ETA: 8s
```

- `47/100`: Completed 47 out of 100 requests
- `✅ 47`: 47 successful requests
- `❌ 0`: 0 failed requests
- `ETA: 8s`: Estimated time to completion

### Final Report

```
📊 Summary:
   Total Requests:    100
   ✅ Successful:     100
   ❌ Failed:         0
   Success Rate:      100.00%
   Actual RPS:        8.52
   Duration:          11.73s

⚡ Response Times:
   Min:               1011.65ms
   Max:               1501.92ms
   Average:           1242.33ms
   P50 (Median):      1184.65ms
   P90:               1389.12ms
   P95:               1445.52ms
   P99:               1501.92ms
```

**Key Metrics to Monitor:**

1. **Success Rate**: Should be > 99% under normal load
2. **Average Response Time**: Target < 200ms (current: 1242ms - SLOW!)
3. **P99 Latency**: Target < 500ms (current: 1501ms - SLOW!)
4. **RPS (Requests Per Second)**: Should match your expected call volume

### Status Codes

```
📈 Status Codes:
   200: 100 (100.0%)
```

- `200`: Successful API responses
- `500`: Server errors (if any)
- Other codes indicate specific issues

### Error Tracking

```
❗ Errors:
   15x HTTP 500: Internal Server Error
   5x connect ECONNREFUSED
```

Shows what went wrong and how many times.

## JSON Report

The tool generates `stress-test-perl-report.json` with detailed statistics:

```json
{
  "config": {
    "api_url": "http://localhost:5000/api/v1/dids/next",
    "concurrent": 10,
    "total_requests": 100,
    "timeout": 30
  },
  "results": {
    "total": 100,
    "successful": 100,
    "failed": 0,
    "success_rate": "100.00%",
    "duration": "11.73s",
    "actual_rps": "8.52",
    "response_times": {
      "min": 1011.65,
      "max": 1501.92,
      "avg": 1242.33,
      "p50": 1184.65,
      "p90": 1389.12,
      "p95": 1445.52,
      "p99": 1501.92
    },
    "status_codes": {
      "200": 100
    },
    "errors": {}
  },
  "timestamp": "2025-11-13T22:30:45Z"
}
```

Use this for:
- Performance tracking over time
- Comparing before/after optimization
- Automated monitoring/alerting

## Interpreting Performance

### ✅ Excellent Performance
- Success Rate: > 99.9%
- Average Response: < 100ms
- P99 Latency: < 300ms
- RPS: > 50

### ✅ Good Performance
- Success Rate: > 99%
- Average Response: < 200ms
- P99 Latency: < 500ms
- RPS: > 20

### ⚠️ Fair Performance (Needs Attention)
- Success Rate: > 95%
- Average Response: < 500ms
- P99 Latency: < 1000ms
- RPS: > 10

### ❌ Poor Performance (Critical)
- Success Rate: < 95%
- Average Response: > 500ms
- P99 Latency: > 1000ms
- RPS: < 10

**Current Status (as of 2025-11-13):**
The endpoint is in **❌ Poor Performance** category:
- Average: 1,242ms (target: <200ms)
- P99: 1,502ms (target: <500ms)
- RPS: 8.52 (target: >20)

**Action Required**: Deploy full optimization (see `PERFORMANCE_TEST_RESULTS.md`)

## Troubleshooting

### All Requests Failing

```bash
# Check if API server is running
curl http://localhost:5000/api/v1/dids/next \
  -H "x-api-key: YOUR_KEY" \
  -d "campaign_id=TEST&agent_id=test&customer_phone=555&customer_state=CA"

# Check dids.conf is readable
cat /etc/asterisk/dids.conf
```

### Slow Response Times

Current issue! The endpoint needs optimization.

**Temporary Workaround**: Reduce concurrent requests
```bash
perl stress-test-dids.pl --config /etc/asterisk/dids.conf --concurrent 5 --requests 50
```

**Permanent Fix**: Deploy optimized endpoint (see `OPTIMIZATION_SUMMARY.md`)

### Permission Denied

```bash
# Make sure script is executable
chmod +x stress-test-dids.pl

# Run as root or vicidial user
sudo perl stress-test-dids.pl --config /etc/asterisk/dids.conf --concurrent 10 --requests 100
```

### Missing Perl Modules

All required modules should be installed with VICIdial. If missing:

```bash
# Install missing module (unlikely needed)
cpan install LWP::UserAgent
cpan install JSON
cpan install Time::HiRes
```

## Comparison with Node.js Tools

| Feature | Perl Tool | Node.js Tools |
|---------|-----------|---------------|
| **Requires** | Perl (already in VICIdial) | Node.js (separate install) |
| **HTTP Client** | LWP::UserAgent ✅ | Node http module |
| **Realistic** | ✅ Same as production | Similar but different |
| **Easy Config** | ✅ Reads dids.conf | Manual config |
| **Max Concurrency** | ~50 (fork limit) | Unlimited (workers) |
| **Best For** | Production testing | Development testing |

**Recommendation**: Use Perl tool for production testing, Node.js tools for development.

## Next Steps

1. **Run Baseline Test**
   ```bash
   perl stress-test-dids.pl --config /etc/asterisk/dids.conf --concurrent 10 --requests 100
   ```

2. **Review Results**
   - Check `stress-test-perl-report.json`
   - Note average response time and P99 latency

3. **If Performance is Poor**
   - See `PERFORMANCE_TEST_RESULTS.md`
   - Deploy optimization from `optimized-dids-next-endpoint.js`
   - Re-test to verify improvement

4. **Set Up Monitoring**
   - Run stress test after each deployment
   - Track metrics over time
   - Alert if success rate drops below 95%

## Support

For issues or questions:
- Check server logs: `pm2 logs did-api`
- Review MongoDB slow queries
- Verify database indexes are built
- See full documentation: `STRESS_TEST_README.md`
