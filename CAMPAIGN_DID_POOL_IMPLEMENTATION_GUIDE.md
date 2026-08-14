# Campaign-Specific DID Pool Implementation Guide

## Overview

This guide documents the implementation of campaign-specific DID pools, allowing different sets of DIDs for different VICIdial campaigns.

## Files Created/Modified

### New Files

1. **[`/models/CampaignDIDPool.js`](/home/na/didapi/models/CampaignDIDPool.js)** - New model for managing campaign-specific DID pools
2. **[`/routes/campaignDIDPools.js`](/home/na/didapi/routes/campaignDIDPools.js)** - API routes for campaign DID pool management
3. **[`/services/campaignDIDPoolService.js`](/home/na/didapi/services/campaignDIDPoolService.js)** - Service layer for campaign DID pool business logic
4. **[`CAMPAIGN_DID_POOL_ARCHITECTURE.md`](/home/na/didapi/CAMPAIGN_DID_POOL_ARCHITECTURE.md)** - Architecture documentation

### Modified Files

1. **[`/models/DID.js`](/home/na/didapi/models/DID.js)** - Added campaign association tracking
2. **[`/models/Campaign.js`](/home/na/didapi/models/Campaign.js)** - Added DID pool configuration
3. **[`/routes/dids.js`](/home/na/didapi/routes/dids.js)** - Updated `/next` endpoint for campaign-based selection
4. **[`/server-full.js`](/home/na/didapi/server-full.js)** - Registered new campaign DID pool routes

## Data Model Changes

### CampaignDIDPool Model

New model with the following key fields:

| Field | Type | Description |
|--------|--------|-------------|
| `tenantId` | ObjectId | Reference to Tenant |
| `campaignId` | String | VICIdial campaign ID |
| `campaignName` | String | Display name |
| `dids` | Array[ObjectId] | DIDs in this pool |
| `rotationStrategy` | Object | Selection strategy configuration |
| `fallback` | Object | Fallback configuration |
| `status` | Object | Pool status and rotation state |
| `stats` | Object | Selection statistics |

### DID Model Updates

Added fields:

| Field | Type | Description |
|--------|--------|-------------|
| `campaignAssociations` | Array | Campaign associations with priority |
| `lastCampaignUsed` | Object | Track last campaign used |

### Campaign Model Updates

Added fields:

| Field | Type | Description |
|--------|--------|-------------|
| `didPool` | Object | DID pool configuration |

## API Endpoints

### Campaign DID Pool Management

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/campaign-did-pools` | GET | List all campaign DID pools |
| `/api/v1/campaign-did-pools` | POST | Create new campaign DID pool |
| `/api/v1/campaign-did-pools/:id` | GET | Get campaign DID pool details |
| `/api/v1/campaign-did-pools/:id` | PUT | Update campaign DID pool |
| `/api/v1/campaign-did-pools/:id` | DELETE | Delete campaign DID pool |
| `/api/v1/campaign-did-pools/:id/dids` | GET | Get DIDs in campaign pool |
| `/api/v1/campaign-did-pools/:id/dids` | POST | Add DIDs to campaign pool |
| `/api/v1/campaign-did-pools/:id/dids` | DELETE | Remove DIDs from campaign pool |
| `/api/v1/campaign-did-pools/:id/rotate` | POST | Manually trigger rotation |
| `/api/v1/campaign-did-pools/:id/stats` | GET | Get pool statistics |

### DID Selection

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/dids/next` | GET | Get next DID (updated with campaign logic) |

## DID Selection Flow

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

## Rotation Strategies

### Round-Robin
- Uses `currentIndex` to cycle through DIDs
- Simple, predictable rotation
- Good for equal distribution

### Least-Used
- Selects DID with lowest `usage.totalCalls`
- Ensures balanced usage across pool
- Prevents DID burnout

### Performance-Based
- Calculates score based on:
  - Answer rate (default weight: 0.5)
  - Connection rate (default weight: 0.3)
  - Reputation score (default weight: 0.2)
- Selects DID with highest performance score
- Optimizes for best results

### Geographic
- Calculates distance between DID and customer
- Sorts DIDs by proximity
- Falls back to least-used if no location info
- Configurable max distance limit

## Database Indexes

### CampaignDIDPool Indexes

```javascript
// For finding pool by campaign
db.campagndidpools.createIndex({ tenantId: 1, campaignId: 1 }, { unique: true });

// For listing pools by tenant
db.campagndidpools.createIndex({ tenantId: 1, 'status.type': 1 });

// For DID lookups
db.campagndidpools.createIndex({ dids: 1 });
```

### DID Indexes

```javascript
// Campaign-specific queries
db.dids.createIndex({ tenantId: 1, 'campaignAssociations.campaignId': 1 });
db.dids.createIndex({ tenantId: 1, 'campaignAssociations.poolId': 1 });
db.dids.createIndex({ 'campaignAssociations.poolId': 1, status: 1 });
```

## Usage Examples

### Create a Campaign DID Pool

```bash
curl -X POST http://localhost:5000/api/v1/campaign-did-pools \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "campaignId": "SALES001",
    "campaignName": "US Sales Campaign",
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
      "fallbackToTenantPool": true
    }
  }'
```

### Add DIDs to Pool

```bash
curl -X POST http://localhost:5000/api/v1/campaign-did-pools/POOL_ID/dids \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "didIds": ["DID_ID_1", "DID_ID_2", "DID_ID_3"],
    "priority": 5
  }'
```

### Get Next DID (with campaign)

```bash
curl "http://localhost:5000/api/v1/dids/next?campaign_id=SALES001&agent_id=1001&customer_phone=4155551234&customer_state=CA&customer_area_code=415" \
  -H "x-api-key: YOUR_API_KEY"
```

### Get Pool Statistics

```bash
curl http://localhost:5000/api/v1/campaign-did-pools/POOL_ID/stats \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## Configuration Options

### Rotation Strategy Config

| Option | Type | Default | Description |
|---------|--------|----------|-------------|
| `dailyLimit` | Number | 200 | Max calls per DID per day |
| `maxDistance` | Number | 500 | Max distance for geographic (miles) |
| `minReputationScore` | Number | 50 | Min reputation score for selection |
| `answerRateWeight` | Number | 0.5 | Weight for answer rate (performance) |
| `connectionRateWeight` | Number | 0.3 | Weight for connection rate (performance) |
| `reputationWeight` | Number | 0.2 | Weight for reputation (performance) |

### Fallback Config

| Option | Type | Default | Description |
|---------|--------|----------|-------------|
| `enabled` | Boolean | true | Enable fallback |
| `fallbackToTenantPool` | Boolean | true | Fall back to tenant pool |
| `fallbackDid` | String | null | Specific fallback DID |

## Backward Compatibility

- Existing `/api/v1/dids/next` endpoint continues to work
- If no campaign pool exists, falls back to tenant pool
- Existing DIDs without campaign associations still work
- Migration script ensures data integrity

## Migration Steps

### Phase 1: Database Migration

```javascript
// Create CampaignDIDPool collection
// Add new indexes to DID collection
// Backfill existing data if needed
```

### Phase 2: Frontend Updates

1. Add campaign DID pool management UI
2. Update DID selection display
3. Add pool statistics dashboard

### Phase 3: Testing

1. Test campaign pool creation
2. Test DID addition/removal
3. Test rotation strategies
4. Test fallback logic
5. Load testing

## Benefits

1. **Granular Control**: Different DIDs for different campaigns
2. **Isolation**: Campaign-specific performance tracking
3. **Flexibility**: Different rotation strategies per campaign
4. **Compliance**: Separate DIDs for regulated campaigns
5. **Optimization**: Campaign-specific geographic targeting
6. **Fallback**: Graceful degradation when pool is exhausted

## Troubleshooting

### Pool Not Found

**Error**: "Campaign DID pool not found"

**Solution**: 
- Verify pool exists in database
- Check tenant ID matches
- Ensure pool is not deleted

### No DIDs Available

**Error**: "All DIDs exhausted, using fallback"

**Solution**:
- Add more DIDs to pool
- Increase daily limit
- Check DID reputation scores
- Enable fallback to tenant pool

### Geographic Selection Not Working

**Issue**: DIDs not sorted by distance

**Solution**:
- Verify DID location data is populated
- Check customer location parameters
- Verify max distance setting
- Check NPANXX data is loaded

## Next Steps

1. Create migration script for existing data
2. Add unit tests for new endpoints
3. Update frontend UI
4. Add monitoring/alerting for pool exhaustion
5. Create analytics dashboard for pool performance

## Support

For questions or issues:
- Review [`CAMPAIGN_DID_POOL_ARCHITECTURE.md`](/home/na/didapi/CAMPAIGN_DID_POOL_ARCHITECTURE.md) for detailed architecture
- Check [`/services/campaignDIDPoolService.js`](/home/na/didapi/services/campaignDIDPoolService.js) for business logic
- Review [`/routes/campaignDIDPools.js`](/home/na/didapi/routes/campaignDIDPools.js) for API implementation
