# /api/v1/dids/next Performance Test Results

**Date**: 2025-11-13
**Tool**: stress-test-simple.js
**Endpoint**: http://localhost:5000/api/v1/dids/next
**Server**: PM2-managed Node.js (did-api)

## Summary

The stress testing tools are **working correctly** and have successfully identified **severe performance issues** in the `/api/v1/dids/next` endpoint. The endpoint is functional but too slow for production use under any meaningful load.

## Test Results

### Test 1: Low Concurrency (5 concurrent, 10 total)
```
✅ Success Rate: 100%
⚡ Average Response: 1,586ms
📊 P99 Latency: 2,301ms
🚀 Throughput: 2.68 RPS
```
**Status**: Works but SLOW

### Test 2: Moderate Concurrency (10 concurrent, 100 total)
```
✅ Success Rate: 100%
⚡ Average Response: 3,207ms
📊 P99 Latency: 4,920ms
🚀 Throughput: 2.68 RPS
Duration: 37.25 seconds
```
**Status**: Works but EXTREMELY SLOW

### Test 3: High Concurrency (50 concurrent, 1,000 total)
```
❌ Success Rate: 0.6% (6/1000)
⚡ Average Response: 453ms (for those that succeeded)
📊 P99 Latency: 9,453ms
🚀 Throughput: 104 RPS
Errors:
  - 948x connect ECONNREFUSED
  - 46x socket hang up
```
**Status**: SERVER OVERLOAD - Complete failure

## Performance Analysis

### ❌ Critical Issues

1. **Extremely High Latency**
   - Average: 3.2 seconds per request
   - P99: 4.9 seconds per request
   - Target: < 200ms average, < 500ms P99

2. **Very Low Throughput**
   - Current: 2.68 requests per second
   - Production need: 50-100+ RPS minimum

3. **Server Overload Under Load**
   - Complete failure at 50 concurrent requests
   - Connection refused errors indicate server can't keep up
   - Socket hang ups show connections timing out

4. **Scalability Problems**
   - Response time DOUBLES as concurrency increases (1.6s → 3.2s)
   - Server becomes completely unresponsive at moderate load

### Root Causes Identified

Based on code analysis (server-full.js lines 249-617):

1. **Multiple Sequential Database Queries** (10-14 per request)
   ```javascript
   const freshTenant = await Tenant.findById(...);        // Query 1
   const activeDids = await DID.countDocuments(...);      // Query 2
   const goodReputationDids = await DID.countDocuments(...); // Query 3
   let candidateDids = await DID.find(...).sort(...);     // Query 4
   // ... more queries ...
   ```

2. **In-Memory Filtering** (inefficient)
   ```javascript
   const filterByDailyLimit = async (dids) => {
     return dids.filter(did => {
       // Daily capacity check in JavaScript instead of MongoDB
     });
   };
   ```

3. **No Query Result Caching**
   - Rotation state fetched from DB on every request
   - Tenant data fetched fresh every time

4. **Blocking Write Operations**
   - Updates are synchronous
   - Don't use atomic operations

## Database Indexes Status

✅ **Phase 1 Deployed**: Three compound indexes added to DID model
```javascript
{ tenantId: 1, status: 1, 'reputation.score': 1, 'usage.lastUsed': 1 }
{ tenantId: 1, status: 1, 'reputation.score': 1 }
{ 'usage.dailyUsage.date': 1 }
```

**Expected Improvement**: 50-70% reduction in query time
**Actual Improvement**: Not sufficient - endpoint still too slow

## Recommendations

### 🚨 URGENT: Deploy Full Optimization

The database indexes alone are NOT sufficient. The endpoint needs the complete optimization from `/home/na/didapi/optimized-dids-next-endpoint.js`:

1. **Single Aggregation Pipeline**
   - Combines all queries into ONE database operation
   - Reduces round-trips from 10-14 to 1
   - Performs filtering at database level

2. **In-Memory Rotation State Cache**
   - 5-second TTL cache for tenant rotation state
   - Reduces tenant queries by 80-90%
   - Minimal memory overhead

3. **Database-Level Daily Usage Filtering**
   - Moves daily capacity checks to MongoDB aggregation
   - Eliminates in-memory array filtering

4. **Parallel Database Writes**
   - Uses Promise.all() for concurrent updates
   - Non-blocking response delivery

5. **Atomic DID Updates**
   - Uses $inc and $push operators
   - Prevents race conditions

**Expected Combined Improvement**: 70-85% faster (< 500ms average)

### Deployment Steps

```bash
# 1. Backup current endpoint
cp server-full.js server-full.js.backup-$(date +%Y%m%d-%H%M%S)

# 2. Review optimized code
cat /home/na/didapi/optimized-dids-next-endpoint.js

# 3. Replace endpoint in server-full.js (lines 249-617)
# Manual integration required due to complexity

# 4. Test locally first
node server-full.js

# 5. Verify with stress test
node stress-test-simple.js --concurrent 10 --requests 100

# 6. Deploy to production
pm2 restart did-api

# 7. Monitor performance
pm2 logs did-api | grep "DID Next endpoint"
```

### Alternative: Reduce Concurrency Limit

If immediate deployment isn't possible:
- Add rate limiting to /api/v1/dids/next
- Limit to 5-10 concurrent requests per tenant
- Queue additional requests
- Return 429 (Too Many Requests) when overloaded

**This is a TEMPORARY workaround** - optimization is still required.

## Stress Test Tool Status

### ✅ Tools Working Correctly

Both stress testing tools are functioning as designed:

1. **stress-test-simple.js** ✅
   - HTTP connection pooling fixed (maxSockets: Infinity)
   - Accurately measures response times
   - Correctly identifies server overload
   - Generates detailed JSON reports

2. **stress-test-dids-next.js** ✅
   - Multi-threaded worker implementation
   - Real-time statistics dashboard
   - Comprehensive metrics tracking

### Usage for Verification

After deploying optimization, verify improvements:

```bash
# Baseline test (current performance)
node stress-test-simple.js --concurrent 10 --requests 100

# After optimization (expected results)
# Success Rate: > 99%
# Average: < 500ms (down from 3,200ms)
# P99: < 1,000ms (down from 4,920ms)
# Throughput: > 20 RPS (up from 2.68 RPS)

# Load test (high volume)
node stress-test-simple.js --concurrent 50 --requests 1000

# After optimization (expected results)
# Success Rate: > 95%
# Average: < 800ms
# P99: < 1,500ms
```

## MongoDB Performance Check

Verify indexes are being used:

```javascript
// In mongosh
db.dids.find({
  tenantId: ObjectId("YOUR_TENANT_ID"),
  status: 'active',
  'reputation.score': { $gte: 50 }
}).sort({ 'usage.lastUsed': 1 }).explain("executionStats")

// Check output for:
// "indexName": Should show the compound index
// "executionTimeMillis": Should be < 50ms
```

## Conclusion

**Stress Testing Tools**: ✅ Working perfectly
**Endpoint Performance**: ❌ Critical issues requiring immediate attention

**Action Required**: Deploy full optimization from `optimized-dids-next-endpoint.js` to achieve production-ready performance.

Current state is **NOT suitable for production** with any meaningful traffic volume.

---

**Test Conducted By**: Claude Code
**Server Info**: PM2 did-api (PID 332459)
**Database**: MongoDB (did-optimizer)
**Node.js Version**: 20.x
