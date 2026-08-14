# Campaign-Specific DID Pool Architecture

## Overview

This document describes the redesigned architecture that enables different sets of DIDs for different campaigns, allowing for more granular control over DID allocation and optimization strategies.

## Current Architecture

### Existing Models

**DID Model** (`/models/DID.js`):
- Has `tenantId` for multi-tenant isolation
- Tracks usage, metrics, reputation, and location
- No direct campaign association
- DIDs are selected from tenant-wide pool

**Campaign Model** (`/models/Campaign.js`):
- Syncs with VICIdial campaigns
- Has `tenantId` for multi-tenant isolation
- No DID pool configuration

**Current Selection Logic** (`/routes/dids.js` - `/api/v1/dids/next`):
```javascript
const did = await DID.findOne({
  tenantId: req.tenant._id,
  status: 'active',
  $or: [
    { lastUsed: null },
    { lastUsed: { $lt: new Date(Date.now() - 60 * 60 * 1000) } }
  ]
}).sort({ lastUsed: 1 });
```
- Selects any active DID from tenant pool
- No campaign-specific logic

## New Architecture

### 1. New Models

#### CampaignDIDPool Model

A new model that defines which DIDs belong to specific campaigns:

```javascript
{
  _id: ObjectId,
  tenantId: ObjectId,           // Reference to Tenant
  campaignId: String,            // VICIdial campaign ID
  campaignName: String,          // Display name
  
  // DID Pool Configuration
  dids: [ObjectId],              // Array of DID IDs in this pool
  poolSize: Number,              // Total DIDs in pool
  activeDids: Number,            // Active DIDs count
  
  // Pool Settings
  rotationStrategy: {
    type: String,                // 'round-robin', 'least-used', 'performance-based', 'geographic'
    config: {                    // Strategy-specific config
      dailyLimit: Number,
      maxDistance: Number,
      minReputationScore: Number
    }
  },
  
  // Fallback Configuration
  fallback: {
    enabled: Boolean,
    fallbackToTenantPool: Boolean,
    fallbackDid: String
  },
  
  // Pool Status
  status: {
    type: String,                // 'active', 'paused', 'exhausted'
    lastRotatedAt: Date,
    currentIndex: Number,        // For round-robin
    rotationHistory: [{
      didId: ObjectId,
      phoneNumber: String,
      selectedAt: Date,
      result: String
    }]
  },
  
  // Statistics
  stats: {
    totalSelections: Number,
    successfulSelections: Number,
    fallbackSelections: Number,
    lastSelectionAt: Date
  },
  
  createdAt: Date,
  updatedAt: Date,
  createdBy: ObjectId,
  updatedBy: ObjectId
}
```

### 2. Updated Models

#### Updated DID Model

Add campaign association tracking:

```javascript
// Add to DID schema:
campaignAssociations: [{
  campaignId: String,            // VICIdial campaign ID
  poolId: ObjectId,              // Reference to CampaignDIDPool
  addedAt: Date,
  addedBy: ObjectId,
  priority: Number               // Priority within campaign pool (1-10)
}],

// Track last campaign used
lastCampaignUsed: {
  campaignId: String,
  poolId: ObjectId,
  usedAt: Date
}
```

#### Updated Campaign Model

Add DID pool settings:

```javascript
// Add to Campaign schema:
didPool: {
  enabled: Boolean,
  poolId: ObjectId,              // Reference to CampaignDIDPool
  rotationStrategy: {
    type: String,
    config: {}
  },
  fallback: {
    enabled: Boolean,
    fallbackToTenantPool: Boolean,
    fallbackDid: String
  }
}
```

### 3. API Endpoints

#### Campaign DID Pool Management

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/campaign-did-pools` | GET | List all campaign DID pools for tenant |
| `/api/v1/campaign-did-pools` | POST | Create new campaign DID pool |
| `/api/v1/campaign-did-pools/:id` | GET | Get campaign DID pool details |
| `/api/v1/campaign-did-pools/:id` | PUT | Update campaign DID pool |
| `/api/v1/campaign-did-pools/:id` | DELETE | Delete campaign DID pool |
| `/api/v1/campaign-did-pools/:id/dids` | GET | Get DIDs in campaign pool |
| `/api/v1/campaign-did-pools/:id/dids` | POST | Add DIDs to campaign pool |
| `/api/v1/campaign-did-pools/:id/dids` | DELETE | Remove DIDs from campaign pool |
| `/api/v1/campaign-did-pools/:id/rotate` | POST | Manually trigger rotation |
| `/api/v1/campaign-did-pools/:id/stats` | GET | Get pool statistics |

#### Updated DID Selection Endpoint

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/dids/next` | GET | Get next DID (updated with campaign logic) |

### 4. DID Selection Algorithm

```
┌─────────────────────────────────────────────────────────────┐
│                    DID Selection Flow                        │
└─────────────────────────────────────────────────────────────┘

1. Request received with campaign_id
   │
   ├─→ Find CampaignDIDPool for campaign_id
   │   │
   │   ├─→ Pool exists and is active?
   │   │   │
   │   │   ├─→ YES: Select DID from campaign pool
   │   │   │   │
   │   │   │   ├─→ Apply rotation strategy
   │   │   │   │   - round-robin: Use currentIndex
   │   │   │   │   - least-used: Sort by usage.totalCalls
   │   │   │   │   - performance-based: Sort by metrics
   │   │   │   │   - geographic: Sort by distance
   │   │   │   │
   │   │   │   ├─→ Apply filters
   │   │   │   │   - status: 'active'
   │   │   │   │   - reputation.score >= minReputationScore
   │   │   │   │   - !hasReachedDailyLimit()
   │   │   │   │
   │   │   │   ├─→ DID found?
   │   │   │   │   ├─→ YES: Return DID, update stats
   │   │   │   │   └─→ NO: Check fallback
   │   │   │
   │   │   └─→ NO: Check fallback
   │
   └─→ Fallback logic
       │
       ├─→ fallback.fallbackToTenantPool?
       │   ├─→ YES: Select from tenant-wide pool
       │   └─→ NO: Use fallback.did
       │
       └─→ Return DID
```

### 5. Database Indexes

#### CampaignDIDPool Indexes

```javascript
// For finding pool by campaign
db.campagndidpools.createIndex({ tenantId: 1, campaignId: 1 }, { unique: true });

// For listing pools by tenant
db.campagndidpools.createIndex({ tenantId: 1, status: 1 });

// For DID lookups
db.campagndidpools.createIndex({ dids: 1 });
```

#### Updated DID Indexes

```javascript
// For campaign-specific queries
db.dids.createIndex({ tenantId: 1, 'campaignAssociations.campaignId': 1 });
db.dids.createIndex({ tenantId: 1, 'campaignAssociations.poolId': 1 });
```

### 6. Service Layer

#### CampaignDIDPoolService

```javascript
class CampaignDIDPoolService {
  // Pool management
  async createPool(tenantId, campaignId, config)
  async getPool(poolId)
  async updatePool(poolId, updates)
  async deletePool(poolId)
  
  // DID management
  async addDidsToPool(poolId, didIds)
  async removeDidsFromPool(poolId, didIds)
  async getPoolDids(poolId)
  
  // Selection
  async selectDid(campaignId, customerInfo)
  async selectByRoundRobin(pool)
  async selectByLeastUsed(pool)
  async selectByPerformance(pool)
  async selectByGeographic(pool, customerInfo)
  
  // Fallback
  async getFallbackDid(pool)
  
  // Statistics
  async getPoolStats(poolId)
  async updatePoolStats(poolId, selectionResult)
}
```

### 7. Migration Strategy

#### Phase 1: Create New Model
1. Create `CampaignDIDPool` model
2. Add indexes

#### Phase 2: Update Existing Models
1. Add `campaignAssociations` to DID model
2. Add `didPool` to Campaign model
3. Create migration script to backfill data

#### Phase 3: Update API Routes
1. Create campaign DID pool routes
2. Update `/api/v1/dids/next` endpoint
3. Add validation middleware

#### Phase 4: Update Service Layer
1. Create `CampaignDIDPoolService`
2. Integrate with existing services
3. Add unit tests

#### Phase 5: Frontend Updates
1. Add campaign DID pool management UI
2. Update DID selection display
3. Add pool statistics dashboard

### 8. Configuration Examples

#### Example Campaign DID Pool

```json
{
  "_id": "507f1f77bcf86cd799439011",
  "tenantId": "507f1f77bcf86cd799439012",
  "campaignId": "SALES001",
  "campaignName": "US Sales Campaign",
  "dids": ["507f1f77bcf86cd799439013", "507f1f77bcf86cd799439014"],
  "poolSize": 2,
  "activeDids": 2,
  "rotationStrategy": {
    "type": "geographic",
    "config": {
      "dailyLimit": 200,
      "maxDistance": 500,
      "minReputationScore": 50
    }
  },
  "fallback": {
    "enabled": true,
    "fallbackToTenantPool": true,
    "fallbackDid": "+18005551234"
  },
  "status": {
    "type": "active",
    "lastRotatedAt": "2025-01-25T10:00:00Z",
    "currentIndex": 0,
    "rotationHistory": []
  },
  "stats": {
    "totalSelections": 150,
    "successfulSelections": 148,
    "fallbackSelections": 2,
    "lastSelectionAt": "2025-01-25T10:30:00Z"
  }
}
```

### 9. Benefits

1. **Granular Control**: Different DIDs for different campaigns
2. **Isolation**: Campaign-specific performance tracking
3. **Flexibility**: Different rotation strategies per campaign
4. **Compliance**: Separate DIDs for regulated campaigns
5. **Optimization**: Campaign-specific geographic targeting
6. **Fallback**: Graceful degradation when pool is exhausted

### 10. Backward Compatibility

- Existing `/api/v1/dids/next` endpoint continues to work
- If no campaign pool exists, falls back to tenant pool
- Existing DIDs without campaign associations still work
- Migration script ensures data integrity

## Implementation Checklist

- [ ] Create `CampaignDIDPool` model
- [ ] Update `DID` model with campaign associations
- [ ] Update `Campaign` model with DID pool settings
- [ ] Create `CampaignDIDPoolService`
- [ ] Create campaign DID pool API routes
- [ ] Update `/api/v1/dids/next` endpoint
- [ ] Create migration script
- [ ] Add unit tests
- [ ] Update API documentation
- [ ] Update frontend UI
