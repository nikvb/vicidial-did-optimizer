# DID Next API Performance Optimization Plan

## Executive Summary

This plan addresses performance optimization for `/api/v1/dids/next` endpoint to achieve sub-100ms response times through database query optimization, geospatial indexing, and multi-tier caching.

**Current Performance**: 250ms-1000ms per request
**Target Performance**: <100ms per request (90th percentile)
**Expected Improvement**: 10x-20x faster

---

## Problem Analysis

### Current Bottlenecks

1. **Multiple Sequential Queries** (250ms-1s total)
   - Line 269: Fetch tenant rotation state
   - Line 288: Count total active DIDs
   - Line 302: Fetch DIDs for strategy 1 (best available)
   - Line 320: Fetch DIDs for strategy 2 (fallback)
   - Line 340: Fetch DIDs for strategy 3 (emergency)
   - Each query adds 50-200ms latency

2. **Inefficient Usage Filtering** (50-100ms)
   - Daily usage calculated in JavaScript (line 291-295)
   - Fetches all DIDs then filters in application layer
   - No database-side capacity limit filtering

3. **No Caching** (DB hit on every request)
   - Rotation state fetched from database every call
   - No usage data caching
   - No DID pool caching

4. **Unused Geospatial Index**
   - 2dsphere index exists on `coordinates` field
   - Current code uses state/areaCode string matching
   - Missing opportunity for fast geographic queries

---

## Proposed Solution Architecture

### 1. Single Aggregation Pipeline

**Goal**: Replace 5 sequential queries with 1 aggregation query

**Implementation**: MongoDB `$facet` operator to run all strategies in parallel

```javascript
const pipeline = [
  // Stage 1: Match tenant's active DIDs
  {
    $match: {
      tenantId: tenantId,
      status: 'active'
    }
  },

  // Stage 2: Add computed fields (today's usage)
  {
    $addFields: {
      todayUsage: {
        $let: {
          vars: {
            todayEntry: {
              $arrayElemAt: [
                {
                  $filter: {
                    input: { $ifNull: ['$usage.dailyUsage', []] },
                    as: 'day',
                    cond: {
                      $and: [
                        { $gte: ['$$day.date', today] },
                        { $lt: ['$$day.date', tomorrow] }
                      ]
                    }
                  }
                },
                0
              ]
            }
          },
          in: { $ifNull: ['$$todayEntry.count', 0] }
        }
      },
      effectiveCapacity: { $ifNull: ['$capacity', defaultCapacity] }
    }
  },

  // Stage 3: Filter DIDs under capacity limit
  {
    $match: {
      $expr: {
        $lt: ['$todayUsage', '$effectiveCapacity']
      }
    }
  },

  // Stage 4: Execute all selection strategies in parallel
  {
    $facet: {
      // Strategy 1: Best DIDs (geographic match + high reputation)
      strategy1: [
        {
          $match: {
            'location.state': customerState,
            'reputation.score': { $gte: 7 }
          }
        },
        { $sort: { 'usage.lastUsed': 1 } },
        { $limit: 10 }
      ],

      // Strategy 2: Good DIDs (state match)
      strategy2: [
        {
          $match: {
            'location.state': customerState,
            'reputation.score': { $gte: 5 }
          }
        },
        { $sort: { 'usage.lastUsed': 1 } },
        { $limit: 10 }
      ],

      // Strategy 3: Any DIDs (reputation threshold)
      strategy3: [
        {
          $match: {
            'reputation.score': { $gte: 3 }
          }
        },
        { $sort: { 'usage.lastUsed': 1 } },
        { $limit: 10 }
      ],

      // Strategy 4: Last resort (any DID)
      strategy4: [
        { $sort: { 'usage.lastUsed': 1 } },
        { $limit: 5 }
      ],

      // Statistics (for monitoring)
      stats: [
        {
          $group: {
            _id: null,
            totalAvailable: { $sum: 1 },
            avgCapacity: { $avg: '$effectiveCapacity' },
            avgUsage: { $avg: '$todayUsage' }
          }
        }
      ]
    }
  }
];
```

**Expected Performance**: 20-50ms (vs current 250ms-1s)

---

### 2. Geographic Query Optimization with NPANXX

**Goal**: Use NPANXX (area code + exchange) for fast geographic DID matching

**Current State**:
- Using state string matching only
- Area code stored in `location.areaCode`
- Not utilizing NPANXX (first 6 digits of phone number) for precise geographic matching

**NPANXX Background**:
- **NPA** (Numbering Plan Area): Area code (first 3 digits) - e.g., "415"
- **NXX** (Exchange): Next 3 digits - e.g., "555"
- **NPANXX**: Combined 6-digit prefix - e.g., "415555"
- Geographic significance: NPANXX codes are geographically assigned and provide precise local presence

**Implementation**: Add NPANXX extraction and matching to aggregation pipeline

```javascript
// Extract customer NPANXX from phone number
const customerNPANXX = customerPhone.substring(0, 6); // First 6 digits
const customerNPA = customerPhone.substring(0, 3);    // Area code

// Add computed field to pipeline
{
  $addFields: {
    // Extract NPANXX from DID phone number
    npanxx: { $substr: ['$phoneNumber', 0, 6] },
    npa: { $substr: ['$phoneNumber', 0, 3] },

    // Calculate geographic match score
    geoMatchScore: {
      $switch: {
        branches: [
          // Perfect match: same NPANXX (same exchange area)
          {
            case: { $eq: [{ $substr: ['$phoneNumber', 0, 6] }, customerNPANXX] },
            then: 100
          },
          // Good match: same NPA (same area code)
          {
            case: { $eq: ['$location.areaCode', customerNPA] },
            then: 75
          },
          // Moderate match: same state
          {
            case: { $eq: ['$location.state', customerState] },
            then: 50
          }
        ],
        default: 0  // No geographic match
      }
    }
  }
}

// Then sort by geographic match score + reputation
{
  $sort: {
    geoMatchScore: -1,
    'reputation.score': -1,
    'usage.lastUsed': 1
  }
}
```

**Enhanced Strategy with NPANXX**:

```javascript
// Strategy 1: Perfect NPANXX match (same exchange)
strategy1: [
  {
    $match: {
      $expr: {
        $eq: [{ $substr: ['$phoneNumber', 0, 6] }, customerNPANXX]
      },
      'reputation.score': { $gte: 7 }
    }
  },
  { $sort: { 'usage.lastUsed': 1 } },
  { $limit: 10 }
],

// Strategy 2: Same area code (NPA match)
strategy2: [
  {
    $match: {
      'location.areaCode': customerNPA,
      'reputation.score': { $gte: 5 }
    }
  },
  { $sort: { 'usage.lastUsed': 1 } },
  { $limit: 10 }
],

// Strategy 3: Same state (existing logic)
strategy3: [
  {
    $match: {
      'location.state': customerState,
      'reputation.score': { $gte: 3 }
    }
  },
  { $sort: { 'usage.lastUsed': 1 } },
  { $limit: 10 }
]
```

**Database Schema Enhancement**:

```javascript
// Add NPANXX field to DID model for faster querying
didSchema.add({
  npanxx: {
    type: String,
    index: true  // Index for fast NPANXX lookups
  }
});

// Auto-populate NPANXX from phoneNumber
didSchema.pre('save', function(next) {
  if (this.phoneNumber && this.phoneNumber.length >= 6) {
    this.npanxx = this.phoneNumber.substring(0, 6);
  }
  next();
});

// Add compound index for NPANXX-based queries
didSchema.index({ tenantId: 1, npanxx: 1, status: 1, 'reputation.score': -1 });
```

**Migration Script** (one-time):

```javascript
// Populate NPANXX field for existing DIDs
await DID.updateMany(
  { npanxx: { $exists: false } },
  [{
    $set: {
      npanxx: { $substr: ['$phoneNumber', 0, 6] }
    }
  }]
);

console.log('NPANXX field populated for all DIDs');
```

**Benefits over Coordinates Approach**:
- ✅ No external service needed (ZIP → coordinates lookup)
- ✅ NPANXX data inherent in phone numbers
- ✅ Simple string matching (faster than geospatial calculations)
- ✅ More accurate for telecom use case (phone number geography)
- ✅ Index size: ~10-20 bytes per DID vs 32 bytes for coordinates

**Expected Performance**: 5-10ms for NPANXX-based query

---

### 3. Multi-Tier Caching Strategy

**Goal**: Reduce database hits by 95%+ with intelligent caching

#### Tier 1: Rotation State Cache (In-Memory)

**What to Cache**: Tenant rotation state (currentIndex, lastReset, usedDidsInCycle)

**TTL**: 60 seconds

**Implementation**:
```javascript
const rotationCache = new Map();

function getCachedRotationState(tenantId) {
  const cached = rotationCache.get(tenantId);
  if (cached && Date.now() - cached.timestamp < 60000) {
    return cached.state;
  }
  return null;
}

function setCachedRotationState(tenantId, state) {
  rotationCache.set(tenantId, {
    state: state,
    timestamp: Date.now()
  });
}

// Clear stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [tenantId, data] of rotationCache.entries()) {
    if (now - data.timestamp > 60000) {
      rotationCache.delete(tenantId);
    }
  }
}, 300000);
```

**Cache Invalidation**:
- On daily reset (midnight UTC)
- On manual rotation state update

#### Tier 2: Usage Tracking Cache (In-Memory)

**What to Cache**: Per-DID usage counts (minute/hour/day granularity)

**Structure**:
```javascript
const usageCache = {
  // tenantId -> didId -> { minute: count, hour: count, day: count, timestamp }
  data: new Map(),

  // Increment usage atomically
  increment(tenantId, didId, timestamp) {
    const key = `${tenantId}:${didId}`;
    const now = new Date(timestamp);
    const minuteKey = `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}-${now.getUTCHours()}-${now.getUTCMinutes()}`;
    const hourKey = `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}-${now.getUTCHours()}`;
    const dayKey = `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}`;

    if (!this.data.has(key)) {
      this.data.set(key, {
        minute: { key: minuteKey, count: 0 },
        hour: { key: hourKey, count: 0 },
        day: { key: dayKey, count: 0 },
        timestamp: now
      });
    }

    const usage = this.data.get(key);

    // Reset counters if time period changed
    if (usage.minute.key !== minuteKey) {
      usage.minute = { key: minuteKey, count: 0 };
    }
    if (usage.hour.key !== hourKey) {
      usage.hour = { key: hourKey, count: 0 };
    }
    if (usage.day.key !== dayKey) {
      usage.day = { key: dayKey, count: 0 };
    }

    // Increment all counters
    usage.minute.count++;
    usage.hour.count++;
    usage.day.count++;
    usage.timestamp = now;

    return usage;
  },

  // Get current usage
  get(tenantId, didId) {
    const key = `${tenantId}:${didId}`;
    return this.data.get(key) || {
      minute: { count: 0 },
      hour: { count: 0 },
      day: { count: 0 }
    };
  },

  // Flush to database (batched every 10 seconds)
  async flushToDatabase() {
    const batch = [];
    const now = new Date();

    for (const [key, usage] of this.data.entries()) {
      const [tenantId, didId] = key.split(':');
      batch.push({
        updateOne: {
          filter: { _id: didId, tenantId: tenantId },
          update: {
            $inc: { 'usage.totalCalls': 1 },
            $set: { 'usage.lastUsed': usage.timestamp },
            $push: {
              'usage.dailyUsage': {
                $each: [{
                  date: new Date(usage.day.key),
                  count: usage.day.count
                }],
                $position: 0,
                $slice: 30  // Keep last 30 days
              }
            }
          }
        }
      });
    }

    if (batch.length > 0) {
      await DID.bulkWrite(batch);
      this.data.clear();
    }
  }
};

// Flush cache to database every 10 seconds
setInterval(() => usageCache.flushToDatabase(), 10000);
```

**TTL**: Flush every 10 seconds (write-behind cache)

**Cache Invalidation**:
- Automatic flush every 10 seconds
- On server shutdown (graceful)

#### Tier 3: DID Pool Cache (In-Memory)

**What to Cache**: Pre-filtered list of available DIDs per tenant

**TTL**: 300 seconds (5 minutes)

**Implementation**:
```javascript
const didPoolCache = new Map();

async function getCachedDIDPool(tenantId) {
  const cached = didPoolCache.get(tenantId);
  if (cached && Date.now() - cached.timestamp < 300000) {
    return cached.dids;
  }

  // Fetch fresh pool
  const dids = await DID.find({
    tenantId: tenantId,
    status: 'active'
  }).select('phoneNumber location reputation capacity usage').lean();

  didPoolCache.set(tenantId, {
    dids: dids,
    timestamp: Date.now()
  });

  return dids;
}
```

**Cache Invalidation**:
- On DID status change (active/inactive)
- On DID creation/deletion
- On capacity/reputation updates

---

### 4. Enhanced Database Indexing

**Required Indexes**:

```javascript
// Existing (keep these)
didSchema.index({ tenantId: 1, status: 1 });
didSchema.index({ phoneNumber: 1, tenantId: 1 }, { unique: true });

// New compound indexes for optimized queries
didSchema.index({
  tenantId: 1,
  status: 1,
  'location.state': 1,
  'reputation.score': -1,
  'usage.lastUsed': 1
});

didSchema.index({
  tenantId: 1,
  status: 1,
  'usage.dailyUsage.date': 1
});

// NPANXX-based geographic matching (Phase 3)
didSchema.index({ npanxx: 1 });  // Fast NPANXX lookups

didSchema.index({
  tenantId: 1,
  npanxx: 1,
  status: 1,
  'reputation.score': -1
});

didSchema.index({
  tenantId: 1,
  'location.areaCode': 1,
  status: 1,
  'reputation.score': -1
});

// Partial index for available DIDs (only active + under capacity)
didSchema.index(
  {
    tenantId: 1,
    'reputation.score': -1,
    'usage.lastUsed': 1
  },
  {
    partialFilterExpression: {
      status: 'active'
    }
  }
);
```

**Index Size Impact**: ~8-12MB per 100k DIDs (with NPANXX indexes)

---

## Performance Projections

### Current Performance Breakdown
```
Total: 250-1000ms
├── DB Query 1 (rotation state): 50-100ms
├── DB Query 2 (count DIDs): 30-80ms
├── DB Query 3 (strategy 1): 50-200ms
├── DB Query 4 (strategy 2): 50-200ms
├── DB Query 5 (strategy 3): 50-200ms
├── Usage filtering (JS): 20-50ms
└── Rotation logic: 10-20ms
```

### Optimized Performance Breakdown
```
Total: 30-80ms (cold) / 10-30ms (hot)
├── Cache lookup: 1-2ms
├── Single aggregation query: 20-50ms (cold) / 5-15ms (hot)
├── Usage increment (async): <1ms
├── Rotation logic: 5-10ms
└── Response serialization: 2-5ms
```

**Improvement Factor**: 10x-20x faster

---

## Implementation Plan

### Phase 1: Database Optimization (Week 1)

**Tasks**:
1. Add new compound indexes to DID schema
2. Test index performance with `explain()` on production data
3. Implement single aggregation pipeline
4. A/B test old vs new query performance

**Success Criteria**:
- Single query replaces 5 queries
- Query time <50ms for 90th percentile
- No regression in result quality

**Files to Modify**:
- `models/DID.js` (add indexes)
- `server-full.js` (replace endpoint logic)

### Phase 2: Caching Layer (Week 2)

**Tasks**:
1. Implement rotation state cache (in-memory)
2. Implement usage tracking cache (write-behind)
3. Add cache invalidation logic
4. Add cache monitoring (hit rate, size)

**Success Criteria**:
- 95%+ cache hit rate for rotation state
- Usage data flushed to DB within 10 seconds
- No data loss on cache flush

**Files to Modify**:
- `server-full.js` (add caching layer)
- Add graceful shutdown handler

### Phase 3: NPANXX Geographic Enhancement (Week 3) - Optional

**Tasks**:
1. Add `npanxx` field to DID schema with index
2. Run migration script to populate NPANXX for existing DIDs
3. Implement NPANXX-based selection strategies in aggregation pipeline
4. A/B test NPANXX matching vs state-only matching
5. Monitor performance and match quality

**Success Criteria**:
- NPANXX queries <10ms
- Better geographic matching than state-only (measure answer rates)
- Perfect match (same NPANXX) prioritized over area code match
- Area code match prioritized over state match

**Files to Modify**:
- `models/DID.js` (add npanxx field, pre-save hook, index)
- `server-full.js` (update aggregation pipeline with NPANXX strategies)
- Add migration script: `scripts/migrate-npanxx.js`

### Phase 4: Monitoring & Tuning (Week 4)

**Tasks**:
1. Add performance metrics (response time, cache hits, query time)
2. Add alerts for slow queries (>100ms)
3. Load testing (1000 req/sec sustained)
4. Optimize based on production data

**Success Criteria**:
- <100ms p90 response time
- <50ms p50 response time
- 1000+ req/sec throughput
- <1% error rate

---

## Rollout Strategy

### Step 1: Feature Flag
Add feature flag to toggle between old/new implementation:
```javascript
const USE_OPTIMIZED_ENDPOINT = process.env.USE_OPTIMIZED_DID_ENDPOINT === 'true';
```

### Step 2: Canary Deployment
- Deploy to 5% of traffic
- Monitor error rates, latency, result quality
- Gradually increase to 25%, 50%, 100%

### Step 3: Full Rollout
- Enable for all tenants
- Remove old code after 2 weeks stable

### Step 4: Monitoring
- Track P50, P90, P99 latencies
- Monitor cache hit rates
- Alert on degradation

---

## Risk Mitigation

### Risk 1: Cache Inconsistency
**Mitigation**:
- Write-behind cache with 10-second flush
- Graceful shutdown hook to flush cache
- Recovery mechanism on startup

### Risk 2: Memory Pressure
**Mitigation**:
- Cache size limits (max 10k entries per cache)
- LRU eviction when limit reached
- Monitor heap usage

### Risk 3: Query Regression
**Mitigation**:
- A/B testing before full rollout
- Feature flag for instant rollback
- Comprehensive integration tests

### Risk 4: Index Lock Issues
**Mitigation**:
- Build indexes in background mode
- Schedule during low-traffic window
- Monitor collection lock time

---

## Monitoring & Metrics

### Key Metrics

```javascript
// Add to endpoint
const metrics = {
  responseTime: Date.now() - startTime,
  cacheHit: cacheHit,
  queryTime: queryEndTime - queryStartTime,
  strategy: selectedStrategy,
  tenant: tenantId
};

// Log for analytics
console.log('DID_SELECTION_METRICS', JSON.stringify(metrics));
```

### Dashboards

**Performance Dashboard**:
- P50/P90/P99 response times (line chart)
- Cache hit rate % (gauge)
- Queries per second (line chart)
- Error rate % (line chart)

**Business Dashboard**:
- DIDs selected per strategy (pie chart)
- Geographic distribution (map)
- Tenant usage patterns (bar chart)
- Capacity utilization (gauge)

---

## Testing Strategy

### Unit Tests
```javascript
describe('DID Selection Optimization', () => {
  test('aggregation pipeline returns correct structure', async () => {
    // Test pipeline execution
  });

  test('usage cache increments correctly', () => {
    // Test cache increment logic
  });

  test('rotation state cache handles TTL', () => {
    // Test cache expiration
  });
});
```

### Integration Tests
```javascript
describe('DID Next Endpoint', () => {
  test('returns DID under capacity in <100ms', async () => {
    const start = Date.now();
    const response = await request(app)
      .get('/api/v1/dids/next')
      .set('x-api-key', apiKey)
      .query({ campaign_id: 'TEST', customer_state: 'CA' });

    expect(Date.now() - start).toBeLessThan(100);
    expect(response.body.success).toBe(true);
  });
});
```

### Load Tests
```bash
# Apache Bench
ab -n 10000 -c 100 -H "x-api-key: YOUR_KEY" \
  "http://localhost:5000/api/v1/dids/next?campaign_id=TEST&customer_state=CA"

# Target: 1000 req/sec, <100ms p90
```

---

## Success Criteria

### Performance Goals
- ✅ Response time <100ms (p90)
- ✅ Response time <50ms (p50)
- ✅ Throughput >1000 req/sec
- ✅ Cache hit rate >95%

### Quality Goals
- ✅ Zero data loss (usage tracking)
- ✅ Same or better DID selection quality
- ✅ <1% error rate

### Operational Goals
- ✅ Graceful degradation on cache failure
- ✅ Easy rollback (feature flag)
- ✅ Comprehensive monitoring

---

## Next Steps

1. **Review this plan** with team for feedback
2. **Create indexes** in staging environment (test impact)
3. **Implement Phase 1** (aggregation pipeline) with feature flag
4. **Load test** in staging (measure improvement)
5. **Deploy** to production with canary rollout

---

## Appendix: Code References

- Current endpoint: `server-full.js:249-448`
- DID model: `models/DID.js`
- Previous optimization attempt: `/tmp/optimized-endpoint-body.txt`
- Existing indexes: `models/DID.js:164-178`
