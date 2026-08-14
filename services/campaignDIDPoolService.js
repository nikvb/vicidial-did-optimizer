import CampaignDIDPool from '../models/CampaignDIDPool.js';
import DID from '../models/DID.js';
import Tenant from '../models/Tenant.js';

/**
 * Campaign DID Pool Service
 * Handles business logic for campaign-specific DID pool management and selection
 */
class CampaignDIDPoolService {
  /**
   * Create a new campaign DID pool
   */
  async createPool(tenantId, campaignId, campaignName, config, userId) {
    // Check if pool already exists
    const existingPool = await CampaignDIDPool.findByCampaign(tenantId, campaignId);
    if (existingPool) {
      throw new Error('Campaign DID pool already exists for this campaign');
    }

    const pool = await CampaignDIDPool.create({
      tenantId,
      campaignId,
      campaignName,
      rotationStrategy: config.rotationStrategy || {
        type: 'round-robin',
        config: {}
      },
      fallback: config.fallback || {
        enabled: true,
        fallbackToTenantPool: true
      },
      createdBy: userId
    });

    return pool;
  }

  /**
   * Get pool by ID
   */
  async getPool(poolId, tenantId) {
    const pool = await CampaignDIDPool.findOne({
      _id: poolId,
      tenantId
    }).populate('dids');

    if (!pool) {
      throw new Error('Campaign DID pool not found');
    }

    return pool;
  }

  /**
   * Update pool configuration
   */
  async updatePool(poolId, tenantId, updates, userId) {
    const pool = await CampaignDIDPool.findOne({
      _id: poolId,
      tenantId
    });

    if (!pool) {
      throw new Error('Campaign DID pool not found');
    }

    const allowedUpdates = ['rotationStrategy', 'status', 'fallback'];
    allowedUpdates.forEach(field => {
      if (updates[field] !== undefined) {
        pool[field] = updates[field];
      }
    });

    pool.updatedBy = userId;
    await pool.save();

    return pool;
  }

  /**
   * Delete pool
   */
  async deletePool(poolId, tenantId) {
    const pool = await CampaignDIDPool.findOne({
      _id: poolId,
      tenantId
    });

    if (!pool) {
      throw new Error('Campaign DID pool not found');
    }

    // Remove campaign associations from DIDs
    await DID.updateMany(
      { _id: { $in: pool.dids } },
      {
        $pull: {
          campaignAssociations: { poolId: pool._id }
        }
      }
    );

    await pool.deleteOne();
    return true;
  }

  /**
   * Add DIDs to pool
   */
  async addDidsToPool(poolId, tenantId, didIds, priority, userId) {
    const pool = await CampaignDIDPool.findOne({
      _id: poolId,
      tenantId
    });

    if (!pool) {
      throw new Error('Campaign DID pool not found');
    }

    // Verify all DIDs belong to this tenant
    const dids = await DID.find({
      _id: { $in: didIds },
      tenantId
    });

    if (dids.length !== didIds.length) {
      throw new Error('Some DIDs not found or do not belong to your tenant');
    }

    // Add DIDs to pool (avoid duplicates)
    const poolDidStrings = pool.dids.map(id => id.toString());
    const newDidIds = didIds.filter(id => !poolDidStrings.includes(id.toString()));
    pool.dids.push(...newDidIds);
    pool.poolSize = pool.dids.length;
    pool.updatedBy = userId;
    await pool.save();

    // Add campaign associations to DIDs
    for (const did of dids) {
      const existingAssociation = did.campaignAssociations.find(
        assoc => assoc.campaignId === pool.campaignId
      );

      if (!existingAssociation) {
        did.campaignAssociations.push({
          campaignId: pool.campaignId,
          poolId: pool._id,
          addedAt: new Date(),
          addedBy: userId,
          priority: priority || 5
        });
        await did.save();
      }
    }

    // Update pool stats
    await pool.updateStats();

    return pool;
  }

  /**
   * Remove DIDs from pool
   */
  async removeDidsFromPool(poolId, tenantId, didIds) {
    const pool = await CampaignDIDPool.findOne({
      _id: poolId,
      tenantId
    });

    if (!pool) {
      throw new Error('Campaign DID pool not found');
    }

    // Remove DIDs from pool
    const removeSet = new Set(didIds.map(id => id.toString()));
    pool.dids = pool.dids.filter(id => !removeSet.has(id.toString()));
    pool.poolSize = pool.dids.length;
    await pool.save();

    // Remove campaign associations from DIDs
    await DID.updateMany(
      { _id: { $in: didIds } },
      {
        $pull: {
          campaignAssociations: {
            campaignId: pool.campaignId,
            poolId: pool._id
          }
        }
      }
    );

    // Update pool stats
    await pool.updateStats();

    return pool;
  }

  /**
   * Get DIDs in pool
   */
  async getPoolDids(poolId, tenantId) {
    const pool = await CampaignDIDPool.findOne({
      _id: poolId,
      tenantId
    });

    if (!pool) {
      throw new Error('Campaign DID pool not found');
    }

    const dids = await DID.find({
      _id: { $in: pool.dids },
      tenantId
    });

    return dids;
  }

  /**
   * Select DID for campaign
   */
  async selectDidForCampaign(tenantId, campaignId, customerInfo) {
    // Try to find campaign-specific DID pool first
    const pool = await CampaignDIDPool.findByCampaign(tenantId, campaignId);

    if (!pool || pool.status.type !== 'active') {
      // No campaign pool or not active, use tenant pool
      return await this.selectFromTenantPool(tenantId);
    }

    // Get next DID from campaign pool
    const selectedDID = await pool.getNextDID(customerInfo);

    if (selectedDID) {
      return {
        did: selectedDID,
        source: 'campaign_pool',
        poolId: pool._id
      };
    }

    // No DID available from campaign pool, check fallback
    if (pool.fallback.enabled) {
      if (pool.fallback.fallbackToTenantPool) {
        return await this.selectFromTenantPool(tenantId);
      } else if (pool.fallback.fallbackDid) {
        return {
          did: {
            phoneNumber: pool.fallback.fallbackDid,
            isFallback: true
          },
          source: 'campaign_fallback_did',
          poolId: pool._id
        };
      }
    }

    // No fallback available
    return null;
  }

  /**
   * Select DID from tenant pool (fallback)
   */
  async selectFromTenantPool(tenantId) {
    // Get tenant rotation state
    const tenant = await Tenant.findById(tenantId);
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    let rotationState = tenant.rotationState || {
      currentIndex: 0,
      lastReset: new Date(),
      usedDidsInCycle: []
    };

    const usedDidsSet = new Set(rotationState.usedDidsInCycle || []);

    // Reset cycle if all DIDs have been used or it's been more than 24 hours
    const activeDids = await DID.countDocuments({ 
      tenantId, 
      status: 'active',
      isActive: true 
    });
    const goodReputationDids = await DID.countDocuments({
      tenantId,
      status: 'active',
      isActive: true,
      'reputation.score': { $gte: 50 }
    });

    const shouldResetCycle = usedDidsSet.size >= goodReputationDids ||
                            (new Date() - new Date(rotationState.lastReset)) > 24 * 60 * 60 * 1000;

    if (shouldResetCycle) {
      rotationState.usedDidsInCycle = [];
      rotationState.lastReset = new Date();
    }

    // Find available DID using least-used strategy
    const did = await DID.findOne({
      tenantId,
      status: 'active',
      isActive: true,
      'reputation.score': { $gte: 50 },
      _id: { $nin: usedDidsSet }
    }).sort({ 'usage.totalCalls': 1, 'usage.lastUsed': 1 });

    if (!did) {
      // All DIDs have been used, reset and try again
      rotationState.usedDidsInCycle = [];
      rotationState.lastReset = new Date();
      await Tenant.findByIdAndUpdate(tenantId, {
        $set: {
          'rotationState': rotationState
        }
      });

      return await DID.findOne({
        tenantId,
        status: 'active',
        isActive: true,
        'reputation.score': { $gte: 50 }
      }).sort({ 'usage.totalCalls': 1, 'usage.lastUsed': 1 });
    }

    return {
      did,
      source: 'tenant_pool',
      poolId: null
    };
  }

  /**
   * Record DID selection
   */
  async recordSelection(poolId, did, result, campaignId, agentId) {
    if (!poolId) return;

    const pool = await CampaignDIDPool.findById(poolId);
    if (pool) {
      await pool.recordSelection(did, result, campaignId, agentId);
    }
  }

  /**
   * Get pool statistics
   */
  async getPoolStats(poolId, tenantId) {
    const pool = await CampaignDIDPool.findOne({
      _id: poolId,
      tenantId
    });

    if (!pool) {
      throw new Error('Campaign DID pool not found');
    }

    const activeDIDs = await pool.getActiveDIDs();
    const isExhausted = await pool.isExhausted();

    // Calculate DID usage statistics
    const didStats = await Promise.all(activeDIDs.map(async (did) => ({
      phoneNumber: did.phoneNumber,
      totalCalls: did.usage?.totalCalls || 0,
      todayUsage: did.getTodayUsage(),
      reputationScore: did.reputation?.score || 50,
      lastUsed: did.usage?.lastUsed
    })));

    return {
      pool: {
        id: pool._id,
        campaignId: pool.campaignId,
        campaignName: pool.campaignName,
        poolSize: pool.poolSize,
        activeDids: pool.activeDids,
        status: pool.status.type
      },
      stats: pool.stats,
      isExhausted,
      dids: didStats,
      rotationStrategy: pool.rotationStrategy,
      fallback: pool.fallback
    };
  }

  /**
   * Manually trigger rotation
   */
  async rotatePool(poolId, tenantId, userId) {
    const pool = await CampaignDIDPool.findOne({
      _id: poolId,
      tenantId
    });

    if (!pool) {
      throw new Error('Campaign DID pool not found');
    }

    pool.status.currentIndex = 0;
    pool.status.lastRotatedAt = new Date();
    pool.updatedBy = userId;
    await pool.save();

    return pool;
  }

  /**
   * List pools by tenant
   */
  async listPoolsByTenant(tenantId, options = {}) {
    const { status, page = 1, limit = 25 } = options;

    const query = { tenantId };
    if (status) {
      query['status.type'] = status;
    }

    const [pools, total] = await Promise.all([
      CampaignDIDPool.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('dids'),
      CampaignDIDPool.countDocuments(query)
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      pools,
      pagination: {
        current: page,
        pages: totalPages,
        total,
        limit,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    };
  }
}

export default new CampaignDIDPoolService();
