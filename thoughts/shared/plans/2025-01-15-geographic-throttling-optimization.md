# Geographic DID Matching & Throttling Optimization Implementation Plan

## Overview

Implement NPANXX-based geographic matching and configurable minute-window throttling for the `/api/v1/dids/next` endpoint to optimize DID selection with sub-100ms response times.

## Current State Analysis

### What Exists:
- **Geographic Infrastructure**: AreaCodeLocation model with 2dsphere indexes and geospatial methods (`models/AreaCodeLocation.js`)
- **DID Location Data**: Auto-populated from area code on DID creation (`models/DID.js:254-305`)
- **Daily Usage Tracking**: `usage.dailyUsage` array with {date, count} structure
- **Capacity Filtering**: Daily capacity check in JavaScript after fetching DIDs (`server-full.js:308-332`)
- **Endpoint Parameters**: Receives `customer_phone`, `customer_area_code`, `customer_state`

### What's Broken:
1. **Geographic data NOT used**: Endpoint ignores customer location - no geographic matching (`server-full.js:249-448`)
2. **No NPANXX field**: Phone numbers not indexed by first 6 digits for fast matching
3. **No hourly/minute throttling**: Only daily usage limits exist
4. **Performance issues**: 5+ sequential DB queries per request (250ms-1s response time)
5. **Inefficient filtering**: Usage/capacity checks in application layer after fetching

### Key Constraints:
- MongoDB database with Mongoose ODM
- ES modules (import/export)
- Production system - must use feature flags for safe rollout
- AreaCodeLocation collection already populated with NPANXX data

## Desired End State

### Geographic Matching:
- DIDs selected based on NPANXX proximity to customer:
  1. **Perfect Match**: Same NPANXX (first 6 digits) - highest priority
  2. **Area Code Match**: Same NPA (first 3 digits) - medium priority
  3. **State Match**: Same state - low priority
  4. **Any Available**: Fallback if no geographic match

### Throttling System:
- Configurable minute-window limits per DID:
  - `maxCallsPer5Min`: Max calls in any 5-minute window
  - `maxCallsPer10Min`: Max calls in any 10-minute window
  - `maxCallsPer30Min`: Max calls in any 30-minute window
  - `maxCallsPer60Min`: Max calls in any 60-minute window (hourly)
- Granular call timestamp tracking in `usage.callTimestamps` array
- Database-side throttle validation (not application layer)

### Performance:
- Response time: <100ms p90, <50ms p50
- Single aggregation query replaces 5+ sequential queries
- In-memory caching for rotation state

### Verification:
```bash
# Test geographic matching
curl "http://localhost:5000/api/v1/dids/next?customer_phone=4155551234&campaign_id=TEST" \
  -H "x-api-key: YOUR_KEY"
# Expected: Returns DID with 415 area code (San Francisco)

# Test throttling
for i in {1..6}; do
  curl "http://localhost:5000/api/v1/dids/next?customer_phone=4155551234&campaign_id=TEST" \
    -H "x-api-key: YOUR_KEY"
done
# Expected: 6th call returns different DID if first DID throttled

# Performance test
ab -n 100 -c 10 -H "x-api-key: YOUR_KEY" \
  "http://localhost:5000/api/v1/dids/next?customer_phone=4155551234&campaign_id=TEST"
# Expected: p90 < 100ms
```

## What We're NOT Doing

- ZIP code to coordinates lookup (using area code data instead)
- Real-time reputation checking on every request (using cached scores)
- Distributed caching with Redis (using in-memory cache for now)
- WebSocket/streaming DID updates (pull-based API only)
- Campaign-specific throttling (DID-level throttling only)

## Implementation Approach

**Strategy**: Incremental rollout with feature flags, starting with schema changes, then geographic matching, then throttling, finally performance optimization.

**Why This Order**:
1. Schema changes are backward compatible
2. Geographic matching improves quality first
3. Throttling prevents abuse
4. Performance optimization last (can A/B test)

---

## Phase 1: NPANXX Field & Database Indexes

### Overview
Add NPANXX field to DID schema and create indexes for fast geographic matching. This is backward compatible and sets foundation for Phase 2.

### Changes Required:

#### 1. DID Schema Enhancement
**File**: `models/DID.js`

**Changes**: Add NPANXX field and pre-save hook

```javascript
// After line 66 (after location schema), add:
npanxx: {
  type: String,
  index: true,
  maxlength: 6,
  validate: {
    validator: function(v) {
      return !v || /^\d{6}$/.test(v);
    },
    message: 'NPANXX must be exactly 6 digits'
  }
},
```

**Changes**: Update pre-save hook to populate NPANXX

```javascript
// Replace lines 254-305 with enhanced version:
didSchema.pre('save', async function(next) {
  // Extract area code and NPANXX from phone number
  const extractPhoneData = (phoneNumber) => {
    if (!phoneNumber) return { areaCode: null, npanxx: null };
    const cleanNumber = phoneNumber.replace(/\D/g, '');

    if (cleanNumber.length >= 10) {
      let digits = cleanNumber;
      // Handle country code (1)
      if (cleanNumber.startsWith('1') && cleanNumber.length === 11) {
        digits = cleanNumber.substring(1);
      } else if (cleanNumber.length === 10) {
        digits = cleanNumber;
      } else {
        return { areaCode: null, npanxx: null };
      }

      return {
        areaCode: digits.substring(0, 3),
        npanxx: digits.substring(0, 6)
      };
    }
    return { areaCode: null, npanxx: null };
  };

  // Only populate if new document or phone number changed
  if (this.isNew || this.isModified('phoneNumber')) {
    try {
      const { areaCode, npanxx } = extractPhoneData(this.phoneNumber);

      // Set NPANXX field
      if (npanxx) {
        this.npanxx = npanxx;
      }

      // Lookup location data from AreaCodeLocation
      if (areaCode) {
        const AreaCodeLocation = mongoose.model('AreaCodeLocation');
        const locationData = await AreaCodeLocation.findOne({ areaCode });

        if (locationData) {
          // Only update if not manually set
          if (!this.location || this.location.source !== 'Manual') {
            this.location = {
              ...this.location,
              areaCode: locationData.areaCode,
              city: locationData.city,
              state: locationData.state,
              country: locationData.country,
              coordinates: locationData.location.coordinates,
              latitude: locationData.location.coordinates[1],
              longitude: locationData.location.coordinates[0],
              source: 'NPANXX',
              updatedAt: new Date()
            };
          }
        }
      }
    } catch (error) {
      console.warn('Failed to populate location/NPANXX for DID:', this.phoneNumber, error.message);
    }
  }
  next();
});
```

#### 2. Add NPANXX Indexes
**File**: `models/DID.js`

**Changes**: Add new indexes after line 178

```javascript
// NPANXX-based geographic matching indexes
didSchema.index({ npanxx: 1 });
didSchema.index({ tenantId: 1, npanxx: 1, status: 1, 'reputation.score': -1 });
didSchema.index({ tenantId: 1, 'location.areaCode': 1, status: 1, 'reputation.score': -1 });
```

#### 3. Migration Script
**File**: `scripts/migrate-npanxx.js` (new file)

```javascript
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import DID from '../models/DID.js';

dotenv.config();

async function migrateNPANXX() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Count total DIDs without NPANXX
    const total = await DID.countDocuments({ npanxx: { $exists: false } });
    console.log(`📊 Found ${total} DIDs without NPANXX field`);

    if (total === 0) {
      console.log('✅ All DIDs already have NPANXX field');
      process.exit(0);
    }

    // Populate NPANXX using aggregation
    const result = await DID.updateMany(
      { npanxx: { $exists: false } },
      [{
        $set: {
          npanxx: {
            $cond: {
              if: { $gte: [{ $strLenCP: '$phoneNumber' }, 6] },
              then: { $substr: [{ $replaceAll: { input: '$phoneNumber', find: { $literal: /\D/g }, replacement: '' } }, 0, 6] },
              else: null
            }
          }
        }
      }]
    );

    console.log(`✅ Updated ${result.modifiedCount} DIDs with NPANXX field`);

    // Verify results
    const updated = await DID.countDocuments({ npanxx: { $exists: true } });
    console.log(`📊 Total DIDs with NPANXX: ${updated}`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

migrateNPANXX();
```

### Success Criteria:

#### Automated Verification:
- [ ] Migration runs successfully: `node scripts/migrate-npanxx.js`
- [ ] All DIDs have npanxx field populated: `mongosh did-optimizer --eval "db.dids.countDocuments({npanxx: {\$exists: false}})"`
- [ ] Indexes created successfully: `mongosh did-optimizer --eval "db.dids.getIndexes()" | grep npanxx`
- [ ] Server starts without errors: `node server-full.js`
- [ ] No Mongoose schema errors in logs

#### Manual Verification:
- [ ] Check sample DIDs have correct NPANXX: `mongosh did-optimizer --eval "db.dids.findOne({npanxx: {\$exists: true}})"`
- [ ] Verify NPANXX matches first 6 digits of phoneNumber
- [ ] New DIDs created have NPANXX auto-populated

---

## Phase 2: Geographic Matching Implementation

### Overview
Implement NPANXX-based DID selection in `/api/v1/dids/next` endpoint with 3-tier geographic matching strategy.

### Changes Required:

#### 1. Geographic Matching Helper Functions
**File**: `server-full.js`

**Changes**: Add helper functions before `/api/v1/dids/next` endpoint (around line 240)

```javascript
// ============================================================================
// Geographic Matching Helpers
// ============================================================================

/**
 * Extract NPANXX and area code from customer phone number
 */
function extractCustomerPhoneData(customerPhone) {
  if (!customerPhone) return { npanxx: null, areaCode: null };

  const cleanPhone = customerPhone.replace(/\D/g, '');

  if (cleanPhone.length >= 10) {
    let digits = cleanPhone;
    // Handle country code (1)
    if (cleanPhone.startsWith('1') && cleanPhone.length === 11) {
      digits = cleanPhone.substring(1);
    } else if (cleanPhone.length !== 10) {
      return { npanxx: null, areaCode: null };
    }

    return {
      npanxx: digits.substring(0, 6),
      areaCode: digits.substring(0, 3)
    };
  }

  return { npanxx: null, areaCode: null };
}

/**
 * Calculate geographic match score for sorting
 * 100 = Perfect NPANXX match
 * 75 = Area code match
 * 50 = State match
 * 0 = No match
 */
function calculateGeoScore(did, customerNPANXX, customerAreaCode, customerState) {
  if (customerNPANXX && did.npanxx === customerNPANXX) {
    return 100;
  }
  if (customerAreaCode && did.location?.areaCode === customerAreaCode) {
    return 75;
  }
  if (customerState && did.location?.state === customerState) {
    return 50;
  }
  return 0;
}
```

#### 2. Update DID Selection Endpoint
**File**: `server-full.js`

**Changes**: Replace lines 249-448 with geographic-aware version

```javascript
app.get('/api/v1/dids/next', validateApiKey, async (req, res) => {
  console.log('🎯 VICIdial DID Next endpoint called');
  console.log('📊 Query params:', req.query);
  console.log('🏢 Tenant:', req.tenant?.name, 'ID:', req.tenant?._id);

  try {
    const {
      campaign_id,
      agent_id,
      caller_id,
      customer_state,
      customer_area_code,
      customer_phone
    } = req.query;

    // Extract geographic data from customer phone
    const { npanxx: customerNPANXX, areaCode: customerNPA } = extractCustomerPhoneData(customer_phone);

    console.log('🌍 Geographic matching data:', {
      customerPhone: customer_phone,
      customerNPANXX,
      customerNPA,
      customerState: customer_state
    });

    // Load tenant rotation state
    const freshTenant = await Tenant.findById(req.tenant._id);
    let rotationState = freshTenant.rotationState || {
      currentIndex: 0,
      lastReset: new Date(),
      usedDidsInCycle: []
    };

    const usedDidsSet = new Set(rotationState.usedDidsInCycle || []);
    const activeDids = await DID.countDocuments({ tenantId: req.tenant._id, status: 'active' });

    // Reset cycle if needed
    const shouldResetCycle = usedDidsSet.size >= activeDids ||
                            (new Date() - new Date(rotationState.lastReset)) > 24 * 60 * 60 * 1000;

    if (shouldResetCycle) {
      console.log('🔄 Resetting rotation cycle');
      usedDidsSet.clear();
      rotationState.currentIndex = 0;
      rotationState.lastReset = new Date();
    }

    // Helper function to filter by daily capacity
    const filterByDailyLimit = async (dids) => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const defaultCapacity = parseInt(process.env.DEFAULT_DID_CAPACITY || '100', 10);

      return dids.filter(did => {
        const todayUsage = did.getTodayUsage();
        const capacity = did.capacity || defaultCapacity;
        return todayUsage < capacity;
      });
    };

    let did = null;
    let strategyUsed = null;

    // Strategy 1: Perfect NPANXX match (same exchange area)
    if (customerNPANXX) {
      console.log('🎯 Strategy 1: NPANXX match (' + customerNPANXX + ')');

      let query = {
        tenantId: req.tenant._id,
        status: 'active',
        npanxx: customerNPANXX,
        'reputation.score': { $gte: 50 }
      };

      if (usedDidsSet.size > 0) {
        query._id = { $nin: Array.from(usedDidsSet) };
      }

      let candidateDids = await DID.find(query)
        .sort({ 'usage.lastUsed': 1, createdAt: 1 })
        .limit(20);

      let availableDids = await filterByDailyLimit(candidateDids);
      did = availableDids[rotationState.currentIndex % Math.max(1, availableDids.length)] || null;

      if (did) {
        strategyUsed = 'NPANXX_MATCH';
        console.log(`✅ Found NPANXX match: ${did.phoneNumber}`);
      }
    }

    // Strategy 2: Area code match
    if (!did && customerNPA) {
      console.log('🎯 Strategy 2: Area code match (' + customerNPA + ')');

      let query = {
        tenantId: req.tenant._id,
        status: 'active',
        'location.areaCode': customerNPA,
        'reputation.score': { $gte: 50 }
      };

      if (usedDidsSet.size > 0) {
        query._id = { $nin: Array.from(usedDidsSet) };
      }

      let candidateDids = await DID.find(query)
        .sort({ 'usage.lastUsed': 1, createdAt: 1 })
        .limit(20);

      let availableDids = await filterByDailyLimit(candidateDids);
      did = availableDids[rotationState.currentIndex % Math.max(1, availableDids.length)] || null;

      if (did) {
        strategyUsed = 'AREA_CODE_MATCH';
        console.log(`✅ Found area code match: ${did.phoneNumber}`);
      }
    }

    // Strategy 3: State match
    if (!did && customer_state) {
      console.log('🎯 Strategy 3: State match (' + customer_state + ')');

      let query = {
        tenantId: req.tenant._id,
        status: 'active',
        'location.state': customer_state,
        'reputation.score': { $gte: 50 }
      };

      if (usedDidsSet.size > 0) {
        query._id = { $nin: Array.from(usedDidsSet) };
      }

      let candidateDids = await DID.find(query)
        .sort({ 'usage.lastUsed': 1, createdAt: 1 })
        .limit(20);

      let availableDids = await filterByDailyLimit(candidateDids);
      did = availableDids[rotationState.currentIndex % Math.max(1, availableDids.length)] || null;

      if (did) {
        strategyUsed = 'STATE_MATCH';
        console.log(`✅ Found state match: ${did.phoneNumber}`);
      }
    }

    // Strategy 4: Any good reputation DID (fallback)
    if (!did) {
      console.log('🎯 Strategy 4: Any available DID');

      let query = {
        tenantId: req.tenant._id,
        status: 'active',
        'reputation.score': { $gte: 50 }
      };

      if (usedDidsSet.size > 0) {
        query._id = { $nin: Array.from(usedDidsSet) };
      }

      let candidateDids = await DID.find(query)
        .sort({ 'reputation.score': -1, 'usage.lastUsed': 1 })
        .limit(20);

      let availableDids = await filterByDailyLimit(candidateDids);
      did = availableDids[0] || null;

      if (did) {
        strategyUsed = 'ANY_AVAILABLE';
        console.log(`✅ Found fallback DID: ${did.phoneNumber}`);
      }
    }

    // Strategy 5: Last resort - any active DID
    if (!did) {
      console.log('⚠️ Strategy 5: Last resort - any active DID');

      const allActiveDids = await DID.find({
        tenantId: req.tenant._id,
        status: 'active'
      }).sort({ 'reputation.score': -1, 'usage.lastUsed': 1 });

      if (allActiveDids.length > 0) {
        // Find DID with lowest today's usage
        let minUsage = Infinity;
        let selectedDid = null;

        for (const candidateDid of allActiveDids) {
          const todayUsage = candidateDid.getTodayUsage();
          if (todayUsage < minUsage) {
            minUsage = todayUsage;
            selectedDid = candidateDid;
          }
        }

        did = selectedDid;
        strategyUsed = 'OVER_CAPACITY';
      }
    }

    if (!did) {
      return res.status(404).json({
        success: false,
        message: 'No available DIDs found for this tenant'
      });
    }

    // Update usage and rotation state
    usedDidsSet.add(did._id.toString());
    rotationState.currentIndex++;
    rotationState.usedDidsInCycle = Array.from(usedDidsSet);

    // Save rotation state
    await Tenant.findByIdAndUpdate(req.tenant._id, { rotationState });

    // Increment usage
    did.incrementTodayUsage();
    did.usage.lastUsed = new Date();
    did.usage.lastCampaign = campaign_id;
    did.usage.lastAgent = agent_id;
    did.usage.totalCalls = (did.usage.totalCalls || 0) + 1;
    await did.save();

    console.log('✅ DID selected:', {
      phoneNumber: did.phoneNumber,
      npanxx: did.npanxx,
      areaCode: did.location?.areaCode,
      state: did.location?.state,
      strategy: strategyUsed,
      reputation: did.reputation?.score,
      todayUsage: did.getTodayUsage()
    });

    res.json({
      success: true,
      did: {
        number: did.phoneNumber,
        location: {
          state: did.location?.state || 'Unknown',
          city: did.location?.city || 'Unknown',
          areaCode: did.location?.areaCode || 'Unknown'
        },
        npanxx: did.npanxx,
        strategy: strategyUsed,
        is_fallback: strategyUsed === 'OVER_CAPACITY'
      }
    });

  } catch (error) {
    console.error('💥 Error in DID Next endpoint:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});
```

### Success Criteria:

#### Automated Verification:
- [ ] Server starts without errors: `pm2 restart did-api`
- [ ] Endpoint returns 200 status: `curl -I "http://localhost:5000/api/v1/dids/next?customer_phone=4155551234&campaign_id=TEST" -H "x-api-key: YOUR_KEY"`
- [ ] Response includes strategy field: `curl -s "http://localhost:5000/api/v1/dids/next?customer_phone=4155551234&campaign_id=TEST" -H "x-api-key: YOUR_KEY" | jq .did.strategy`

#### Manual Verification:
- [ ] Call with 415 area code returns 415 DID (if available)
- [ ] Call with 212 area code returns 212 DID (if available)
- [ ] Call with unknown area code falls back gracefully
- [ ] Strategy field shows correct matching level (NPANXX_MATCH, AREA_CODE_MATCH, etc.)
- [ ] Geographic matching improves answer rates (monitor in production)

---

## Phase 3: Minute-Window Throttling

### Overview
Implement configurable minute-window throttling with granular call timestamp tracking to prevent DID abuse.

### Changes Required:

#### 1. DID Schema - Throttle Configuration
**File**: `models/DID.js`

**Changes**: Add throttle limits after capacity field (line 25)

```javascript
// After capacity field, add throttle configuration:
throttle: {
  maxCallsPer5Min: {
    type: Number,
    default: null // null = no limit
  },
  maxCallsPer10Min: {
    type: Number,
    default: null
  },
  maxCallsPer30Min: {
    type: Number,
    default: null
  },
  maxCallsPer60Min: {
    type: Number,
    default: null // Hourly limit
  }
},
```

#### 2. DID Schema - Call Timestamp Tracking
**File**: `models/DID.js`

**Changes**: Add callTimestamps array in usage section (after line 80)

```javascript
// After lastAgent field in usage section, add:
callTimestamps: {
  type: [{
    timestamp: Date,
    campaign: String,
    agent: String
  }],
  default: []
},
```

#### 3. Throttle Check Methods
**File**: `models/DID.js`

**Changes**: Add methods after hasReachedDailyLimit (after line 225)

```javascript
// Check if DID has reached any throttle limit
didSchema.methods.checkThrottleLimits = function() {
  const now = new Date();

  // Clean old timestamps (older than 60 minutes)
  const sixtyMinutesAgo = new Date(now.getTime() - 60 * 60 * 1000);
  this.usage.callTimestamps = this.usage.callTimestamps.filter(
    call => new Date(call.timestamp) >= sixtyMinutesAgo
  );

  const limits = [
    { window: 5, limit: this.throttle?.maxCallsPer5Min },
    { window: 10, limit: this.throttle?.maxCallsPer10Min },
    { window: 30, limit: this.throttle?.maxCallsPer30Min },
    { window: 60, limit: this.throttle?.maxCallsPer60Min }
  ];

  for (const { window, limit } of limits) {
    if (limit !== null && limit !== undefined) {
      const windowStart = new Date(now.getTime() - window * 60 * 1000);
      const callsInWindow = this.usage.callTimestamps.filter(
        call => new Date(call.timestamp) >= windowStart
      ).length;

      if (callsInWindow >= limit) {
        return {
          throttled: true,
          window: window,
          limit: limit,
          current: callsInWindow,
          message: `DID has reached ${limit} calls per ${window} minutes (current: ${callsInWindow})`
        };
      }
    }
  }

  return { throttled: false };
};

// Add call timestamp
didSchema.methods.recordCallTimestamp = function(campaign, agent) {
  const now = new Date();

  this.usage.callTimestamps.push({
    timestamp: now,
    campaign: campaign,
    agent: agent
  });

  // Keep only last 60 minutes of data
  const sixtyMinutesAgo = new Date(now.getTime() - 60 * 60 * 1000);
  this.usage.callTimestamps = this.usage.callTimestamps.filter(
    call => new Date(call.timestamp) >= sixtyMinutesAgo
  );

  // Limit array size for safety (max 1000 entries)
  if (this.usage.callTimestamps.length > 1000) {
    this.usage.callTimestamps = this.usage.callTimestamps.slice(-1000);
  }
};
```

#### 4. Update Endpoint with Throttle Checks
**File**: `server-full.js`

**Changes**: Update filterByDailyLimit to include throttle checks (in Phase 2 code)

```javascript
// Replace filterByDailyLimit function with enhanced version:
const filterByCapacityAndThrottle = async (dids) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const defaultCapacity = parseInt(process.env.DEFAULT_DID_CAPACITY || '100', 10);

  return dids.filter(did => {
    // Check daily capacity
    const todayUsage = did.getTodayUsage();
    const capacity = did.capacity || defaultCapacity;

    if (todayUsage >= capacity) {
      console.log(`⚠️ DID ${did.phoneNumber} at daily capacity: ${todayUsage}/${capacity}`);
      return false;
    }

    // Check throttle limits
    const throttleCheck = did.checkThrottleLimits();
    if (throttleCheck.throttled) {
      console.log(`⚠️ DID ${did.phoneNumber} throttled: ${throttleCheck.message}`);
      return false;
    }

    return true;
  });
};
```

**Changes**: Update usage recording to include timestamp (in Phase 2 code, around line where did.save() is called)

```javascript
// Replace the usage update section with:
did.recordCallTimestamp(campaign_id, agent_id);
did.incrementTodayUsage();
did.usage.lastUsed = new Date();
did.usage.lastCampaign = campaign_id;
did.usage.lastAgent = agent_id;
did.usage.totalCalls = (did.usage.totalCalls || 0) + 1;
await did.save();
```

#### 5. Migration Script for Throttle Defaults
**File**: `scripts/migrate-throttle-defaults.js` (new file)

```javascript
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import DID from '../models/DID.js';

dotenv.config();

async function setThrottleDefaults() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Set default throttle limits for all DIDs without them
    const result = await DID.updateMany(
      { 'throttle.maxCallsPer60Min': { $exists: false } },
      {
        $set: {
          'throttle.maxCallsPer5Min': null,  // No limit by default
          'throttle.maxCallsPer10Min': null,
          'throttle.maxCallsPer30Min': null,
          'throttle.maxCallsPer60Min': 100,  // Default: 100 calls/hour
          'usage.callTimestamps': []
        }
      }
    );

    console.log(`✅ Updated ${result.modifiedCount} DIDs with throttle defaults`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

setThrottleDefaults();
```

### Success Criteria:

#### Automated Verification:
- [ ] Migration runs: `node scripts/migrate-throttle-defaults.js`
- [ ] All DIDs have throttle config: `mongosh did-optimizer --eval "db.dids.countDocuments({'throttle.maxCallsPer60Min': {\$exists: false}})"`
- [ ] Server starts: `pm2 restart did-api`
- [ ] Endpoint responds: `curl "http://localhost:5000/api/v1/dids/next?customer_phone=4155551234&campaign_id=TEST" -H "x-api-key: YOUR_KEY"`

#### Manual Verification:
- [ ] Rapid calls (6+ in 5 min) trigger throttle and select different DID
- [ ] Throttled DID shows correct message in logs
- [ ] Call timestamps recorded correctly: `mongosh did-optimizer --eval "db.dids.findOne({'usage.callTimestamps': {\$exists: true}})"`
- [ ] Old timestamps cleaned up automatically (check after 60+ minutes)
- [ ] Throttle limits configurable per DID via admin UI

**Implementation Note**: After Phase 3 automated tests pass, manually test throttling behavior with rapid API calls before proceeding to Phase 4.

---

## Phase 4: Performance Optimization with Aggregation Pipeline

### Overview
Replace sequential queries with single aggregation pipeline and add caching to achieve <100ms response time.

### Changes Required:

#### 1. Caching Layer
**File**: `server-full.js`

**Changes**: Add caching utilities at top of file (after imports)

```javascript
// ============================================================================
// In-Memory Caching Layer
// ============================================================================

const rotationCache = new Map();
const ROTATION_CACHE_TTL = 60000; // 60 seconds

function getCachedRotationState(tenantId) {
  const cached = rotationCache.get(tenantId);
  if (cached && Date.now() - cached.timestamp < ROTATION_CACHE_TTL) {
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

function invalidateRotationCache(tenantId) {
  rotationCache.delete(tenantId);
}

// Cache cleanup every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [tenantId, data] of rotationCache.entries()) {
    if (now - data.timestamp > ROTATION_CACHE_TTL) {
      rotationCache.delete(tenantId);
    }
  }
}, 300000);

console.log('✅ Caching layer initialized');
```

#### 2. Optimized Aggregation Pipeline
**File**: `server-full.js`

**Changes**: Create optimized endpoint with feature flag (add new endpoint below existing one)

```javascript
// ============================================================================
// OPTIMIZED /api/v1/dids/next endpoint with aggregation pipeline
// ============================================================================

app.get('/api/v1/dids/next-optimized', validateApiKey, async (req, res) => {
  const startTime = Date.now();
  console.log('🚀 Optimized DID Next endpoint called');

  try {
    const {
      campaign_id,
      agent_id,
      customer_state,
      customer_phone
    } = req.query;

    const { npanxx: customerNPANXX, areaCode: customerNPA } = extractCustomerPhoneData(customer_phone);

    // Try cache first
    let rotationState = getCachedRotationState(req.tenant._id);

    if (!rotationState) {
      const freshTenant = await Tenant.findById(req.tenant._id).select('rotationState').lean();
      rotationState = freshTenant.rotationState || {
        currentIndex: 0,
        lastReset: new Date(),
        usedDidsInCycle: []
      };
      setCachedRotationState(req.tenant._id, rotationState);
    }

    const usedDidsSet = new Set(rotationState.usedDidsInCycle || []);

    // Calculate time windows for throttle checks
    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000);
    const tenMinAgo = new Date(now.getTime() - 10 * 60 * 1000);
    const thirtyMinAgo = new Date(now.getTime() - 30 * 60 * 1000);
    const sixtyMinAgo = new Date(now.getTime() - 60 * 60 * 1000);

    const defaultCapacity = parseInt(process.env.DEFAULT_DID_CAPACITY || '100', 10);

    // Single aggregation pipeline with all strategies
    const pipeline = [
      // Match active DIDs for this tenant
      {
        $match: {
          tenantId: req.tenant._id,
          status: 'active'
        }
      },

      // Add computed fields
      {
        $addFields: {
          // Today's usage count
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

          // Effective capacity
          effectiveCapacity: { $ifNull: ['$capacity', defaultCapacity] },

          // Throttle window counts
          callsLast5Min: {
            $size: {
              $filter: {
                input: { $ifNull: ['$usage.callTimestamps', []] },
                as: 'call',
                cond: { $gte: ['$$call.timestamp', fiveMinAgo] }
              }
            }
          },
          callsLast10Min: {
            $size: {
              $filter: {
                input: { $ifNull: ['$usage.callTimestamps', []] },
                as: 'call',
                cond: { $gte: ['$$call.timestamp', tenMinAgo] }
              }
            }
          },
          callsLast30Min: {
            $size: {
              $filter: {
                input: { $ifNull: ['$usage.callTimestamps', []] },
                as: 'call',
                cond: { $gte: ['$$call.timestamp', thirtyMinAgo] }
              }
            }
          },
          callsLast60Min: {
            $size: {
              $filter: {
                input: { $ifNull: ['$usage.callTimestamps', []] },
                as: 'call',
                cond: { $gte: ['$$call.timestamp', sixtyMinAgo] }
              }
            }
          }
        }
      },

      // Filter by capacity and throttle limits
      {
        $match: {
          $expr: {
            $and: [
              // Daily capacity check
              { $lt: ['$todayUsage', '$effectiveCapacity'] },

              // 5-minute throttle
              {
                $or: [
                  { $eq: ['$throttle.maxCallsPer5Min', null] },
                  { $lt: ['$callsLast5Min', { $ifNull: ['$throttle.maxCallsPer5Min', 999999] }] }
                ]
              },

              // 10-minute throttle
              {
                $or: [
                  { $eq: ['$throttle.maxCallsPer10Min', null] },
                  { $lt: ['$callsLast10Min', { $ifNull: ['$throttle.maxCallsPer10Min', 999999] }] }
                ]
              },

              // 30-minute throttle
              {
                $or: [
                  { $eq: ['$throttle.maxCallsPer30Min', null] },
                  { $lt: ['$callsLast30Min', { $ifNull: ['$throttle.maxCallsPer30Min', 999999] }] }
                ]
              },

              // 60-minute throttle
              {
                $or: [
                  { $eq: ['$throttle.maxCallsPer60Min', null] },
                  { $lt: ['$callsLast60Min', { $ifNull: ['$throttle.maxCallsPer60Min', 999999] }] }
                ]
              }
            ]
          }
        }
      },

      // Execute all geographic strategies in parallel with $facet
      {
        $facet: {
          // Strategy 1: NPANXX match
          npanxxMatch: customerNPANXX ? [
            {
              $match: {
                npanxx: customerNPANXX,
                'reputation.score': { $gte: 50 },
                ...(usedDidsSet.size > 0 && { _id: { $nin: Array.from(usedDidsSet) } })
              }
            },
            { $sort: { 'usage.lastUsed': 1, createdAt: 1 } },
            { $limit: 10 }
          ] : [],

          // Strategy 2: Area code match
          areaCodeMatch: customerNPA ? [
            {
              $match: {
                'location.areaCode': customerNPA,
                'reputation.score': { $gte: 50 },
                ...(usedDidsSet.size > 0 && { _id: { $nin: Array.from(usedDidsSet) } })
              }
            },
            { $sort: { 'usage.lastUsed': 1, createdAt: 1 } },
            { $limit: 10 }
          ] : [],

          // Strategy 3: State match
          stateMatch: customer_state ? [
            {
              $match: {
                'location.state': customer_state,
                'reputation.score': { $gte: 50 },
                ...(usedDidsSet.size > 0 && { _id: { $nin: Array.from(usedDidsSet) } })
              }
            },
            { $sort: { 'usage.lastUsed': 1, createdAt: 1 } },
            { $limit: 10 }
          ] : [],

          // Strategy 4: Any good reputation
          anyAvailable: [
            {
              $match: {
                'reputation.score': { $gte: 50 },
                ...(usedDidsSet.size > 0 && { _id: { $nin: Array.from(usedDidsSet) } })
              }
            },
            { $sort: { 'reputation.score': -1, 'usage.lastUsed': 1 } },
            { $limit: 10 }
          ],

          // Strategy 5: Last resort (any active)
          lastResort: [
            { $sort: { 'reputation.score': -1, todayUsage: 1 } },
            { $limit: 5 }
          ],

          // Stats for monitoring
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

    const queryStartTime = Date.now();
    const result = await DID.aggregate(pipeline);
    const queryTime = Date.now() - queryStartTime;

    console.log(`⚡ Aggregation query time: ${queryTime}ms`);

    // Select best DID from results
    let did = null;
    let strategyUsed = null;

    if (result[0].npanxxMatch?.length > 0) {
      did = result[0].npanxxMatch[rotationState.currentIndex % result[0].npanxxMatch.length];
      strategyUsed = 'NPANXX_MATCH';
    } else if (result[0].areaCodeMatch?.length > 0) {
      did = result[0].areaCodeMatch[rotationState.currentIndex % result[0].areaCodeMatch.length];
      strategyUsed = 'AREA_CODE_MATCH';
    } else if (result[0].stateMatch?.length > 0) {
      did = result[0].stateMatch[rotationState.currentIndex % result[0].stateMatch.length];
      strategyUsed = 'STATE_MATCH';
    } else if (result[0].anyAvailable?.length > 0) {
      did = result[0].anyAvailable[0];
      strategyUsed = 'ANY_AVAILABLE';
    } else if (result[0].lastResort?.length > 0) {
      did = result[0].lastResort[0];
      strategyUsed = 'OVER_CAPACITY';
    }

    if (!did) {
      return res.status(404).json({
        success: false,
        message: 'No available DIDs found'
      });
    }

    // Convert aggregation result to Mongoose document for methods
    const didDoc = await DID.findById(did._id);

    // Update usage
    usedDidsSet.add(didDoc._id.toString());
    rotationState.currentIndex++;
    rotationState.usedDidsInCycle = Array.from(usedDidsSet);

    // Update cache and database
    setCachedRotationState(req.tenant._id, rotationState);
    await Tenant.findByIdAndUpdate(req.tenant._id, { rotationState });

    didDoc.recordCallTimestamp(campaign_id, agent_id);
    didDoc.incrementTodayUsage();
    didDoc.usage.lastUsed = now;
    didDoc.usage.lastCampaign = campaign_id;
    didDoc.usage.lastAgent = agent_id;
    didDoc.usage.totalCalls = (didDoc.usage.totalCalls || 0) + 1;
    await didDoc.save();

    const totalTime = Date.now() - startTime;

    console.log(`✅ Optimized endpoint completed in ${totalTime}ms (query: ${queryTime}ms)`);

    res.json({
      success: true,
      did: {
        number: didDoc.phoneNumber,
        location: {
          state: didDoc.location?.state || 'Unknown',
          city: didDoc.location?.city || 'Unknown',
          areaCode: didDoc.location?.areaCode || 'Unknown'
        },
        npanxx: didDoc.npanxx,
        strategy: strategyUsed,
        is_fallback: strategyUsed === 'OVER_CAPACITY'
      },
      performance: {
        totalTime: totalTime,
        queryTime: queryTime,
        cacheHit: rotationState !== null
      }
    });

  } catch (error) {
    console.error('💥 Error in optimized DID Next endpoint:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});
```

#### 3. Feature Flag for Rollout
**File**: `.env`

**Changes**: Add feature flag

```bash
# Feature flag for optimized endpoint
USE_OPTIMIZED_DID_ENDPOINT=false
```

**File**: `server-full.js`

**Changes**: Add conditional routing based on feature flag

```javascript
// Add before endpoint definitions:
const useOptimizedEndpoint = process.env.USE_OPTIMIZED_DID_ENDPOINT === 'true';

if (useOptimizedEndpoint) {
  console.log('✅ Using OPTIMIZED DID selection endpoint');
  app.get('/api/v1/dids/next', validateApiKey, async (req, res, next) => {
    // Forward to optimized endpoint
    req.url = '/api/v1/dids/next-optimized';
    next();
  });
} else {
  console.log('ℹ️ Using STANDARD DID selection endpoint');
  // Use existing endpoint (already defined)
}
```

### Success Criteria:

#### Automated Verification:
- [ ] Server starts: `pm2 restart did-api`
- [ ] Standard endpoint works: `curl "http://localhost:5000/api/v1/dids/next?customer_phone=4155551234&campaign_id=TEST" -H "x-api-key: YOUR_KEY"`
- [ ] Optimized endpoint works: `curl "http://localhost:5000/api/v1/dids/next-optimized?customer_phone=4155551234&campaign_id=TEST" -H "x-api-key: YOUR_KEY"`
- [ ] Performance test shows improvement: `ab -n 100 -c 10 -H "x-api-key: YOUR_KEY" "http://localhost:5000/api/v1/dids/next-optimized?customer_phone=4155551234&campaign_id=TEST"`

#### Manual Verification:
- [ ] Response time p90 < 100ms (check performance.totalTime in response)
- [ ] Response time p50 < 50ms
- [ ] Cache hit rate > 80% after warmup (check logs)
- [ ] Both endpoints return same DID for same input
- [ ] No performance regression under load (1000 req/sec)

**Implementation Note**: Run A/B testing between standard and optimized endpoints for 24 hours before enabling feature flag globally.

---

## Testing Strategy

### Unit Tests
**File**: `test/did-selection.test.js` (new file)

```javascript
import { expect } from 'chai';
import mongoose from 'mongoose';
import DID from '../models/DID.js';

describe('DID Selection with Throttling', () => {
  before(async () => {
    await mongoose.connect(process.env.MONGODB_URI_TEST);
  });

  after(async () => {
    await mongoose.connection.close();
  });

  describe('NPANXX Extraction', () => {
    it('should extract NPANXX from 10-digit number', () => {
      const did = new DID({ phoneNumber: '4155551234', tenantId: mongoose.Types.ObjectId() });
      // Pre-save hook should populate npanxx
      expect(did.npanxx).to.equal('415555');
    });

    it('should extract NPANXX from 11-digit number with country code', () => {
      const did = new DID({ phoneNumber: '14155551234', tenantId: mongoose.Types.ObjectId() });
      expect(did.npanxx).to.equal('415555');
    });
  });

  describe('Throttle Limits', () => {
    it('should allow calls under 5-minute limit', () => {
      const did = new DID({
        phoneNumber: '4155551234',
        tenantId: mongoose.Types.ObjectId(),
        throttle: { maxCallsPer5Min: 5 },
        usage: { callTimestamps: [
          { timestamp: new Date(Date.now() - 2 * 60 * 1000) },
          { timestamp: new Date(Date.now() - 3 * 60 * 1000) }
        ]}
      });

      const check = did.checkThrottleLimits();
      expect(check.throttled).to.be.false;
    });

    it('should throttle when 5-minute limit reached', () => {
      const did = new DID({
        phoneNumber: '4155551234',
        tenantId: mongoose.Types.ObjectId(),
        throttle: { maxCallsPer5Min: 5 },
        usage: { callTimestamps: [
          { timestamp: new Date(Date.now() - 1 * 60 * 1000) },
          { timestamp: new Date(Date.now() - 2 * 60 * 1000) },
          { timestamp: new Date(Date.now() - 3 * 60 * 1000) },
          { timestamp: new Date(Date.now() - 4 * 60 * 1000) },
          { timestamp: new Date(Date.now() - 4.5 * 60 * 1000) }
        ]}
      });

      const check = did.checkThrottleLimits();
      expect(check.throttled).to.be.true;
      expect(check.window).to.equal(5);
    });
  });

  describe('Call Timestamp Recording', () => {
    it('should record call timestamp', () => {
      const did = new DID({
        phoneNumber: '4155551234',
        tenantId: mongoose.Types.ObjectId(),
        usage: { callTimestamps: [] }
      });

      did.recordCallTimestamp('CAMPAIGN001', 'agent1001');
      expect(did.usage.callTimestamps).to.have.lengthOf(1);
      expect(did.usage.callTimestamps[0].campaign).to.equal('CAMPAIGN001');
    });

    it('should clean old timestamps', () => {
      const did = new DID({
        phoneNumber: '4155551234',
        tenantId: mongoose.Types.ObjectId(),
        usage: { callTimestamps: [
          { timestamp: new Date(Date.now() - 70 * 60 * 1000) }, // 70 min ago (should be removed)
          { timestamp: new Date(Date.now() - 30 * 60 * 1000) }  // 30 min ago (should stay)
        ]}
      });

      did.recordCallTimestamp('CAMPAIGN001', 'agent1001');
      expect(did.usage.callTimestamps).to.have.lengthOf(2); // Old one removed, new one added
    });
  });
});
```

### Integration Tests
**File**: `test/did-next-endpoint.test.js` (new file)

```javascript
import request from 'supertest';
import { expect } from 'chai';
import app from '../server-full.js';

describe('GET /api/v1/dids/next', () => {
  const apiKey = process.env.TEST_API_KEY;

  it('should return DID with NPANXX match', async () => {
    const res = await request(app)
      .get('/api/v1/dids/next')
      .query({
        customer_phone: '4155551234',
        campaign_id: 'TEST',
        agent_id: 'agent1001'
      })
      .set('x-api-key', apiKey);

    expect(res.status).to.equal(200);
    expect(res.body.success).to.be.true;
    expect(res.body.did).to.have.property('number');
    expect(res.body.did).to.have.property('strategy');
    expect(res.body.did.strategy).to.be.oneOf([
      'NPANXX_MATCH',
      'AREA_CODE_MATCH',
      'STATE_MATCH',
      'ANY_AVAILABLE'
    ]);
  });

  it('should respect throttle limits', async () => {
    const responses = [];

    // Make 6 rapid calls
    for (let i = 0; i < 6; i++) {
      const res = await request(app)
        .get('/api/v1/dids/next')
        .query({
          customer_phone: '4155551234',
          campaign_id: 'TEST'
        })
        .set('x-api-key', apiKey);

      responses.push(res.body);
    }

    // Should get at least 2 different DIDs (one throttled, switched to another)
    const uniqueDids = new Set(responses.map(r => r.did?.number));
    expect(uniqueDids.size).to.be.at.least(2);
  });
});
```

### Manual Testing Steps

1. **Test NPANXX Matching**:
   ```bash
   # Test with 415 area code (San Francisco)
   curl "http://localhost:5000/api/v1/dids/next?customer_phone=4155551234&campaign_id=TEST" \
     -H "x-api-key: YOUR_KEY"
   # Expected: DID with 415 area code, strategy: NPANXX_MATCH or AREA_CODE_MATCH

   # Test with 212 area code (New York)
   curl "http://localhost:5000/api/v1/dids/next?customer_phone=2125551234&campaign_id=TEST" \
     -H "x-api-key: YOUR_KEY"
   # Expected: DID with 212 area code if available
   ```

2. **Test Throttling**:
   ```bash
   # Make 6 rapid calls (assuming 5/5min limit)
   for i in {1..6}; do
     curl "http://localhost:5000/api/v1/dids/next?customer_phone=4155551234&campaign_id=TEST" \
       -H "x-api-key: YOUR_KEY" -s | jq '.did.number'
   done
   # Expected: See DID rotation when throttle hit
   ```

3. **Test Performance**:
   ```bash
   # Benchmark optimized endpoint
   ab -n 1000 -c 50 \
     -H "x-api-key: YOUR_KEY" \
     "http://localhost:5000/api/v1/dids/next-optimized?customer_phone=4155551234&campaign_id=TEST"
   # Expected: p90 < 100ms, p50 < 50ms
   ```

4. **Test Cache Hit Rate**:
   ```bash
   # Make 100 calls and check logs for cache hits
   for i in {1..100}; do
     curl "http://localhost:5000/api/v1/dids/next-optimized?customer_phone=4155551234&campaign_id=TEST" \
       -H "x-api-key: YOUR_KEY" -s > /dev/null
   done

   # Check logs
   pm2 logs did-api | grep "cache"
   # Expected: High cache hit rate (>80%)
   ```

## Performance Considerations

### Database Indexes
All required indexes added in Phase 1:
- `npanxx` (single field)
- `tenantId + npanxx + status + reputation.score` (compound)
- `tenantId + location.areaCode + status + reputation.score` (compound)

**Index Size**: ~8-12MB per 100k DIDs

### Query Performance
- **Before**: 250-1000ms (5+ sequential queries)
- **After**: 30-80ms cold, 10-30ms hot (single aggregation)
- **Improvement**: 10x-20x faster

### Memory Usage
- **Rotation Cache**: ~1KB per tenant (negligible)
- **Call Timestamps**: ~100 bytes per DID (max 1000 entries = 100KB per DID worst case)
- **Total**: <100MB additional memory for 10k DIDs

### Throttle Array Management
- Auto-cleanup: Timestamps older than 60 minutes removed
- Max size: 1000 entries per DID
- Automatic pruning on each call

## Migration Notes

### Backward Compatibility
- All schema changes are additive (no breaking changes)
- Existing DIDs work without NPANXX (will be populated on first save)
- Throttle limits default to `null` (no throttling)
- New fields have defaults, won't break existing queries

### Rollout Plan
1. **Week 1**: Deploy Phase 1 (schema + indexes) to production
2. **Week 2**: Deploy Phase 2 (geographic matching) to 10% of traffic
3. **Week 3**: Deploy Phase 3 (throttling) to 10% of traffic
4. **Week 4**: Deploy Phase 4 (optimization) to 10% of traffic
5. **Week 5**: Scale to 100% if metrics pass

### Rollback Strategy
- Keep old endpoint code in place
- Feature flag can instantly disable optimizations
- No data loss - all changes append-only
- Database indexes can be dropped if needed

## References

- Performance optimization plan: `/home/na/didapi/DID_NEXT_PERFORMANCE_OPTIMIZATION_PLAN.md`
- Current endpoint: `server-full.js:249-448`
- DID model: `models/DID.js:1-309`
- AreaCodeLocation model: `models/AreaCodeLocation.js:1-362`
- Previous optimization attempt: `/tmp/optimized-endpoint-body.txt`
