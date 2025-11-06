import mongoose from 'mongoose';

// High-performance call record model for millions of records daily
const callRecordSchema = new mongoose.Schema({
  // Core identifiers - heavily indexed
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true,
    index: true
  },
  didId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DID',
    required: false,  // Optional - VICIdial doesn't track outbound DID in vicidial_log
    index: true
  },
  phoneNumber: {
    type: String,
    required: true,
    index: true
  },

  // Call details
  callTimestamp: {
    type: Date,
    required: true,
    index: true
  },
  duration: {
    type: Number,
    default: 0,
    min: 0
  },
  result: {
    type: String,
    enum: ['answered', 'busy', 'no_answer', 'failed', 'dropped'],
    required: true,
    index: true
  },
  disposition: {
    type: String,
    required: true
  },

  // VICIdial specific data
  campaignId: {
    type: String,
    required: true,
    index: true
  },
  agentId: {
    type: String,
    index: true
  },
  leadId: {
    type: String,
    index: true
  },
  listId: {
    type: String,
    index: true
  },

  // Customer data (anonymized for analytics)
  customerPhone: {
    type: String,
    index: true
  },
  customerState: {
    type: String,
    maxlength: 2,
    index: true
  },
  customerAreaCode: {
    type: String,
    maxlength: 3,
    index: true
  },
  customerZip: {
    type: String,
    maxlength: 10
  },

  // Performance metrics
  ringTime: Number,
  talkTime: Number,
  holdTime: Number,

  // Cost tracking
  cost: {
    type: Number,
    default: 0,
    min: 0
  },

  // Minimal metadata - keep it lean for performance
  metadata: {
    callDirection: {
      type: String,
      enum: ['inbound', 'outbound'],
      default: 'outbound'
    },
    recording: {
      type: Boolean,
      default: false
    }
  }
}, {
  timestamps: false, // Disable auto timestamps for performance
  versionKey: false  // Disable version key for space savings
});

// Critical indexes for high-performance queries on millions of records
// Time-based sharding index (most important)
callRecordSchema.index({
  tenantId: 1,
  callTimestamp: 1
}, {
  name: 'tenant_time_shard',
  background: true
});

// Campaign performance analysis
callRecordSchema.index({
  tenantId: 1,
  campaignId: 1,
  callTimestamp: 1,
  result: 1
}, {
  name: 'campaign_performance',
  background: true
});

// DID rotation optimization
callRecordSchema.index({
  didId: 1,
  callTimestamp: 1,
  result: 1
}, {
  name: 'did_rotation_opt',
  background: true
});

// Geographic analysis
callRecordSchema.index({
  tenantId: 1,
  customerState: 1,
  customerAreaCode: 1,
  callTimestamp: 1
}, {
  name: 'geographic_analysis',
  background: true,
  sparse: true
});

// Agent performance
callRecordSchema.index({
  tenantId: 1,
  agentId: 1,
  callTimestamp: 1,
  result: 1
}, {
  name: 'agent_performance',
  background: true,
  sparse: true
});

// Daily aggregation helper
callRecordSchema.index({
  tenantId: 1,
  callTimestamp: 1,
  result: 1
}, {
  name: 'daily_aggregation',
  background: true
});

// Partial index for successful calls only (space optimization)
callRecordSchema.index({
  tenantId: 1,
  didId: 1,
  duration: 1
}, {
  name: 'successful_calls_duration',
  partialFilterExpression: { result: 'answered', duration: { $gt: 0 } },
  background: true
});

// Static methods for high-performance aggregations
callRecordSchema.statics.getDailyStats = function(tenantId, date) {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  return this.aggregate([
    {
      $match: {
        tenantId: new mongoose.Types.ObjectId(tenantId),
        callTimestamp: { $gte: startOfDay, $lte: endOfDay }
      }
    },
    {
      $group: {
        _id: null,
        totalCalls: { $sum: 1 },
        totalAnswered: {
          $sum: { $cond: [{ $eq: ['$result', 'answered'] }, 1, 0] }
        },
        totalDuration: {
          $sum: { $cond: [{ $eq: ['$result', 'answered'] }, '$duration', 0] }
        },
        avgDuration: {
          $avg: { $cond: [{ $eq: ['$result', 'answered'] }, '$duration', null] }
        },
        totalCost: { $sum: '$cost' }
      }
    }
  ]).allowDiskUse(true);
};

// Efficient campaign performance aggregation
callRecordSchema.statics.getCampaignPerformance = function(tenantId, startDate, endDate, limit = 100) {
  return this.aggregate([
    {
      $match: {
        tenantId: new mongoose.Types.ObjectId(tenantId),
        callTimestamp: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $group: {
        _id: '$campaignId',
        totalCalls: { $sum: 1 },
        answered: {
          $sum: { $cond: [{ $eq: ['$result', 'answered'] }, 1, 0] }
        },
        avgDuration: {
          $avg: { $cond: [{ $eq: ['$result', 'answered'] }, '$duration', null] }
        },
        totalCost: { $sum: '$cost' }
      }
    },
    {
      $addFields: {
        answerRate: {
          $multiply: [
            { $divide: ['$answered', '$totalCalls'] },
            100
          ]
        },
        costPerCall: { $divide: ['$totalCost', '$totalCalls'] }
      }
    },
    { $sort: { totalCalls: -1 } },
    { $limit: limit }
  ]).allowDiskUse(true);
};

// DID performance analysis for rotation optimization
callRecordSchema.statics.getDIDPerformance = function(tenantId, startDate, endDate) {
  return this.aggregate([
    {
      $match: {
        tenantId: new mongoose.Types.ObjectId(tenantId),
        callTimestamp: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $group: {
        _id: '$didId',
        phoneNumber: { $first: '$phoneNumber' },
        totalCalls: { $sum: 1 },
        answered: {
          $sum: { $cond: [{ $eq: ['$result', 'answered'] }, 1, 0] }
        },
        busy: {
          $sum: { $cond: [{ $eq: ['$result', 'busy'] }, 1, 0] }
        },
        failed: {
          $sum: { $cond: [{ $eq: ['$result', 'failed'] }, 1, 0] }
        },
        avgDuration: {
          $avg: { $cond: [{ $eq: ['$result', 'answered'] }, '$duration', null] }
        },
        lastUsed: { $max: '$callTimestamp' }
      }
    },
    {
      $addFields: {
        answerRate: {
          $multiply: [
            { $divide: ['$answered', '$totalCalls'] },
            100
          ]
        },
        failureRate: {
          $multiply: [
            { $divide: [{ $add: ['$busy', '$failed'] }, '$totalCalls'] },
            100
          ]
        }
      }
    },
    { $sort: { answerRate: -1, totalCalls: -1 } }
  ]).allowDiskUse(true);
};

// Geographic performance analysis
callRecordSchema.statics.getGeographicPerformance = function(tenantId, startDate, endDate) {
  return this.aggregate([
    {
      $match: {
        tenantId: new mongoose.Types.ObjectId(tenantId),
        callTimestamp: { $gte: startDate, $lte: endDate },
        customerState: { $exists: true, $ne: null }
      }
    },
    {
      $group: {
        _id: {
          state: '$customerState',
          areaCode: '$customerAreaCode'
        },
        totalCalls: { $sum: 1 },
        answered: {
          $sum: { $cond: [{ $eq: ['$result', 'answered'] }, 1, 0] }
        },
        avgDuration: {
          $avg: { $cond: [{ $eq: ['$result', 'answered'] }, '$duration', null] }
        }
      }
    },
    {
      $addFields: {
        answerRate: {
          $multiply: [
            { $divide: ['$answered', '$totalCalls'] },
            100
          ]
        }
      }
    },
    { $sort: { '_id.state': 1, '_id.areaCode': 1 } }
  ]).allowDiskUse(true);
};

// Time-series data for charts (hourly aggregation)
callRecordSchema.statics.getHourlyStats = function(tenantId, date) {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  return this.aggregate([
    {
      $match: {
        tenantId: new mongoose.Types.ObjectId(tenantId),
        callTimestamp: { $gte: startOfDay, $lte: endOfDay }
      }
    },
    {
      $group: {
        _id: {
          hour: { $hour: '$callTimestamp' }
        },
        totalCalls: { $sum: 1 },
        answered: {
          $sum: { $cond: [{ $eq: ['$result', 'answered'] }, 1, 0] }
        },
        avgDuration: {
          $avg: { $cond: [{ $eq: ['$result', 'answered'] }, '$duration', null] }
        }
      }
    },
    {
      $addFields: {
        answerRate: {
          $multiply: [
            { $divide: ['$answered', '$totalCalls'] },
            100
          ]
        }
      }
    },
    { $sort: { '_id.hour': 1 } }
  ]).allowDiskUse(true);
};

// Enable read preference for analytics queries
callRecordSchema.set('read', 'secondary');

const CallRecord = mongoose.model('CallRecord', callRecordSchema);

export default CallRecord;