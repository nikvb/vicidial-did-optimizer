import mongoose from 'mongoose';

const rotationRuleSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true,
    index: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  priority: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  
  // Rotation Strategy
  rotationAlgorithm: {
    type: String,
    enum: ['round_robin', 'weighted', 'performance_based', 'geographic', 'time_based', 'least_used', 'custom'],
    default: 'round_robin'
  },
  
  // Time-based restrictions
  timeRestrictions: {
    enabled: {
      type: Boolean,
      default: false
    },
    timezone: {
      type: String,
      default: 'America/New_York'
    },
    allowedHours: {
      start: {
        type: String,
        default: '09:00'
      },
      end: {
        type: String,
        default: '17:00'
      }
    },
    allowedDays: [{
      type: String,
      enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
    }],
    cooldownPeriod: {
      type: Number,
      default: 30, // minutes
      min: 0
    }
  },
  
  // Geographic preferences
  geographicSettings: {
    enabled: {
      type: Boolean,
      default: false
    },
    preferredRegions: [{
      type: String,
      enum: ['north_america', 'south_america', 'europe', 'asia', 'africa', 'oceania']
    }],
    statePreferences: [{
      state: String,
      weight: {
        type: Number,
        min: 0,
        max: 100,
        default: 50
      }
    }],
    localMatching: {
      type: Boolean,
      default: false
    }
  },
  
  // Performance thresholds
  performanceThresholds: {
    minAnswerRate: {
      type: Number,
      min: 0,
      max: 100,
      default: 70
    },
    minConnectionRate: {
      type: Number,
      min: 0,
      max: 100,
      default: 85
    },
    maxDropRate: {
      type: Number,
      min: 0,
      max: 100,
      default: 10
    },
    minCallQualityScore: {
      type: Number,
      min: 0,
      max: 10,
      default: 7
    },
    evaluationPeriod: {
      type: Number,
      default: 24, // hours
      min: 1
    }
  },
  
  // TCPA Compliance
  tcpaCompliance: {
    enabled: {
      type: Boolean,
      default: true
    },
    respectDoNotCall: {
      type: Boolean,
      default: true
    },
    consentRequired: {
      type: Boolean,
      default: true
    },
    recordingDisclosure: {
      type: Boolean,
      default: true
    },
    optOutHandling: {
      type: String,
      enum: ['immediate', 'next_cycle', 'manual'],
      default: 'immediate'
    },
    callerIdCompliance: {
      type: Boolean,
      default: true
    }
  },
  
  // Custom algorithm parameters
  customParameters: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  
  // Application scope
  appliesTo: {
    campaigns: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Campaign'
    }],
    didPools: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DIDPool'
    }],
    allCampaigns: {
      type: Boolean,
      default: false
    }
  },
  
  // Metrics and monitoring
  metrics: {
    timesApplied: {
      type: Number,
      default: 0
    },
    lastApplied: Date,
    averagePerformance: {
      type: Number,
      min: 0,
      max: 100
    },
    violations: [{
      type: {
        type: String,
        enum: ['performance', 'time', 'geographic', 'tcpa']
      },
      timestamp: {
        type: Date,
        default: Date.now
      },
      details: String
    }]
  }
}, {
  timestamps: true
});

// Indexes for performance
rotationRuleSchema.index({ tenantId: 1, isActive: 1 });
rotationRuleSchema.index({ priority: -1 });
rotationRuleSchema.index({ 'appliesTo.campaigns': 1 });
rotationRuleSchema.index({ 'appliesTo.didPools': 1 });

// Virtual for rule effectiveness
rotationRuleSchema.virtual('effectiveness').get(function() {
  if (this.metrics.timesApplied === 0) return null;
  return this.metrics.averagePerformance || 0;
});

// Method to check if rule applies to a campaign
rotationRuleSchema.methods.appliesToCampaign = function(campaignId) {
  if (this.appliesTo.allCampaigns) return true;
  return this.appliesTo.campaigns.some(id => id.toString() === campaignId.toString());
};

// Method to validate time restrictions
rotationRuleSchema.methods.isValidTime = function(timestamp = new Date()) {
  if (!this.timeRestrictions.enabled) return true;
  
  const date = new Date(timestamp);
  const dayName = date.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
  const time = date.toTimeString().substring(0, 5);
  
  // Check allowed days
  if (this.timeRestrictions.allowedDays.length > 0 && 
      !this.timeRestrictions.allowedDays.includes(dayName)) {
    return false;
  }
  
  // Check allowed hours
  const startTime = this.timeRestrictions.allowedHours.start;
  const endTime = this.timeRestrictions.allowedHours.end;
  
  return time >= startTime && time <= endTime;
};

// Method to get next valid time window
rotationRuleSchema.methods.getNextValidTime = function() {
  if (!this.timeRestrictions.enabled) return new Date();
  
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(parseInt(this.timeRestrictions.allowedHours.start.split(':')[0]), 
                   parseInt(this.timeRestrictions.allowedHours.start.split(':')[1]), 0, 0);
  
  return tomorrow;
};

export default mongoose.model('RotationRule', rotationRuleSchema);