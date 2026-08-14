import mongoose from 'mongoose';

const campaignDIDPoolSchema = new mongoose.Schema({
  // Tenant and Campaign association
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true,
    index: true
  },
  campaignId: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  campaignName: {
    type: String,
    required: true,
    trim: true
  },

  // DID Pool Configuration
  dids: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DID'
  }],
  poolSize: {
    type: Number,
    default: 0,
    min: 0
  },
  activeDids: {
    type: Number,
    default: 0,
    min: 0
  },

  // Rotation Strategy Configuration
  rotationStrategy: {
    type: {
      type: String,
      enum: ['round-robin', 'least-used', 'performance-based', 'geographic'],
      default: 'round-robin'
    },
    config: {
      // Daily usage limit per DID
      dailyLimit: {
        type: Number,
        default: 200,
        min: 1
      },
      // Maximum distance for geographic matching (miles)
      maxDistance: {
        type: Number,
        default: 500,
        min: 0
      },
      // Minimum reputation score for DID selection
      minReputationScore: {
        type: Number,
        default: 50,
        min: 0,
        max: 100
      },
      // Priority weighting for performance-based selection
      answerRateWeight: {
        type: Number,
        default: 0.5,
        min: 0,
        max: 1
      },
      connectionRateWeight: {
        type: Number,
        default: 0.3,
        min: 0,
        max: 1
      },
      reputationWeight: {
        type: Number,
        default: 0.2,
        min: 0,
        max: 1
      }
    }
  },

  // Fallback Configuration
  fallback: {
    enabled: {
      type: Boolean,
      default: true
    },
    fallbackToTenantPool: {
      type: Boolean,
      default: true
    },
    fallbackDid: {
      type: String,
      trim: true,
      match: /^[\+]?[1-9][\d\s\-()]*$/
    }
  },

  // Pool Status
  status: {
    type: {
      type: String,
      enum: ['active', 'paused', 'exhausted'],
      default: 'active'
    },
    lastRotatedAt: {
      type: Date,
      default: Date.now
    },
    currentIndex: {
      type: Number,
      default: 0,
      min: 0
    },
    rotationHistory: [{
      didId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'DID'
      },
      phoneNumber: String,
      selectedAt: {
        type: Date,
        default: Date.now
      },
      result: {
        type: String,
        enum: ['success', 'fallback', 'error']
      },
      campaignId: String,
      agentId: String
    }]
  },

  // Statistics
  stats: {
    totalSelections: {
      type: Number,
      default: 0
    },
    successfulSelections: {
      type: Number,
      default: 0
    },
    fallbackSelections: {
      type: Number,
      default: 0
    },
    lastSelectionAt: {
      type: Date
    }
  },

  // Audit fields
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true,
  strict: false
});

// Compound indexes for efficient queries
campaignDIDPoolSchema.index({ tenantId: 1, campaignId: 1 }, { unique: true });
campaignDIDPoolSchema.index({ tenantId: 1, 'status.type': 1 });
campaignDIDPoolSchema.index({ dids: 1 });

// Method to get active DIDs from pool
campaignDIDPoolSchema.methods.getActiveDIDs = async function() {
  const DID = mongoose.model('DID');
  return await DID.find({
    _id: { $in: this.dids },
    status: 'active',
    isActive: true
  });
};

// Method to check if pool is exhausted
campaignDIDPoolSchema.methods.isExhausted = async function() {
  const activeDIDs = await this.getActiveDIDs();
  
  // Check if any active DID hasn't reached daily limit
  for (const did of activeDIDs) {
    if (!did.hasReachedDailyLimit(this.rotationStrategy.config.dailyLimit)) {
      return false;
    }
  }
  
  return true;
};

// Method to get next DID based on rotation strategy
campaignDIDPoolSchema.methods.getNextDID = async function(customerInfo = {}) {
  const DID = mongoose.model('DID');
  const { customerState, customerZip, customerPhone } = customerInfo;
  
  // Get active DIDs from pool
  const activeDIDs = await this.getActiveDIDs();
  
  if (activeDIDs.length === 0) {
    return null;
  }
  
  // Filter DIDs based on constraints
  const filteredDIDs = activeDIDs.filter(did => {
    // Check reputation score
    if (did.reputation?.score < this.rotationStrategy.config.minReputationScore) {
      return false;
    }
    
    // Check daily limit
    if (did.hasReachedDailyLimit(this.rotationStrategy.config.dailyLimit)) {
      return false;
    }
    
    return true;
  });
  
  if (filteredDIDs.length === 0) {
    return null;
  }
  
  let selectedDID;
  
  switch (this.rotationStrategy.type) {
    case 'round-robin':
      selectedDID = this.selectByRoundRobin(filteredDIDs);
      break;
      
    case 'least-used':
      selectedDID = this.selectByLeastUsed(filteredDIDs);
      break;
      
    case 'performance-based':
      selectedDID = this.selectByPerformance(filteredDIDs);
      break;
      
    case 'geographic':
      selectedDID = await this.selectByGeographic(filteredDIDs, customerInfo);
      break;
      
    default:
      selectedDID = this.selectByRoundRobin(filteredDIDs);
  }
  
  return selectedDID;
};

// Round-robin selection
campaignDIDPoolSchema.methods.selectByRoundRobin = function(dids) {
  if (this.status.currentIndex >= dids.length) {
    this.status.currentIndex = 0;
  }

  const selectedDID = dids[this.status.currentIndex];
  this.status.currentIndex = (this.status.currentIndex + 1) % dids.length;
  this.status.lastRotatedAt = new Date();

  return selectedDID;
};

// Least-used selection
campaignDIDPoolSchema.methods.selectByLeastUsed = function(dids) {
  return dids.reduce((least, did) => {
    const leastUsage = least.usage?.totalCalls || 0;
    const didUsage = did.usage?.totalCalls || 0;
    return didUsage < leastUsage ? did : least;
  });
};

// Performance-based selection
campaignDIDPoolSchema.methods.selectByPerformance = function(dids) {
  const config = this.rotationStrategy.config;
  
  return dids.reduce((best, did) => {
    const bestScore = this.calculatePerformanceScore(best, config);
    const didScore = this.calculatePerformanceScore(did, config);
    return didScore > bestScore ? did : best;
  });
};

// Calculate performance score
campaignDIDPoolSchema.methods.calculatePerformanceScore = function(did, config) {
  const metrics = did.metrics || {};
  
  const answerRate = metrics.totalAnswered / (metrics.totalCalls || 1);
  const connectionRate = metrics.totalConnected / (metrics.totalCalls || 1);
  const reputationScore = did.reputation?.score || 50;
  
  return (
    answerRate * config.answerRateWeight +
    connectionRate * config.connectionRateWeight +
    (reputationScore / 100) * config.reputationWeight
  );
};

// Geographic selection
campaignDIDPoolSchema.methods.selectByGeographic = async function(dids, customerInfo) {
  if (!customerInfo.customerZip && !customerInfo.customerState) {
    // Fall back to least-used if no location info
    return this.selectByLeastUsed(dids);
  }

  // Find customer location from zip or state
  const AreaCodeLocation = mongoose.model('AreaCodeLocation');
  let customerLocation = null;

  if (customerInfo.customerZip) {
    customerLocation = await AreaCodeLocation.findOne({ zipCode: customerInfo.customerZip });
  }

  if (!customerLocation && customerInfo.customerState) {
    customerLocation = await AreaCodeLocation.findOne({ state: customerInfo.customerState });
  }

  if (!customerLocation) {
    return this.selectByLeastUsed(dids);
  }
  
  // Sort by distance
  const sortedDIDs = [...dids].sort((a, b) => {
    const distanceA = a.getDistanceFrom(
      customerLocation.location.coordinates[1],
      customerLocation.location.coordinates[0]
    );
    const distanceB = b.getDistanceFrom(
      customerLocation.location.coordinates[1],
      customerLocation.location.coordinates[0]
    );
    
    return distanceA - distanceB;
  });
  
  // Filter by max distance
  const maxDistance = this.rotationStrategy.config.maxDistance;
  const nearbyDIDs = sortedDIDs.filter(did => {
    const distance = did.getDistanceFrom(
      customerLocation.location.coordinates[1],
      customerLocation.location.coordinates[0]
    );
    return distance <= maxDistance;
  });
  
  if (nearbyDIDs.length > 0) {
    return nearbyDIDs[0];
  }
  
  // Fall back to least-used if no nearby DIDs
  return this.selectByLeastUsed(dids);
};

// Method to record selection
campaignDIDPoolSchema.methods.recordSelection = async function(did, result, campaignId, agentId) {
  this.stats.totalSelections++;
  
  if (result === 'success') {
    this.stats.successfulSelections++;
  } else if (result === 'fallback') {
    this.stats.fallbackSelections++;
  }
  
  this.stats.lastSelectionAt = new Date();
  
  // Add to rotation history (keep last 100)
  this.status.rotationHistory.push({
    didId: did._id,
    phoneNumber: did.phoneNumber,
    selectedAt: new Date(),
    result,
    campaignId,
    agentId
  });
  
  if (this.status.rotationHistory.length > 100) {
    this.status.rotationHistory = this.status.rotationHistory.slice(-100);
  }
  
  await this.save();
};

// Method to update pool statistics
campaignDIDPoolSchema.methods.updateStats = async function() {
  const activeDIDs = await this.getActiveDIDs();
  this.poolSize = this.dids.length;
  this.activeDids = activeDIDs.length;
  
  // Check if pool should be marked as exhausted
  if (this.activeDids === 0 || await this.isExhausted()) {
    this.status.type = 'exhausted';
  } else if (this.status.type === 'exhausted') {
    // Reactivate if DIDs are available
    this.status.type = 'active';
  }
  
  await this.save();
};

// Static method to find pool by campaign
campaignDIDPoolSchema.statics.findByCampaign = function(tenantId, campaignId) {
  return this.findOne({
    tenantId,
    campaignId,
    'status.type': { $ne: 'deleted' }
  });
};

// Static method to list pools by tenant
campaignDIDPoolSchema.statics.listByTenant = function(tenantId, options = {}) {
  const { status, page = 1, limit = 25 } = options;
  
  const query = { tenantId };
  if (status) {
    query['status.type'] = status;
  }
  
  return this.find(query)
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit);
};

const CampaignDIDPool = mongoose.model('CampaignDIDPool', campaignDIDPoolSchema);

export default CampaignDIDPool;
