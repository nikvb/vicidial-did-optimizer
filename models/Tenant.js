import mongoose from 'mongoose';

const tenantSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  domain: {
    type: String,
    unique: true,
    sparse: true,
    lowercase: true,
    trim: true
  },
  subdomain: {
    type: String,
    unique: true,
    sparse: true, // Allow null/undefined for backwards compatibility
    lowercase: true,
    trim: true,
    match: /^[a-z0-9-]+$/
  },
  isActive: {
    type: Boolean,
    default: true
  },
  subscription: {
    plan: {
      type: String,
      enum: ['starter', 'professional', 'enterprise'],
      default: 'starter'
    },
    status: {
      type: String,
      enum: ['active', 'cancelled', 'suspended', 'trial'],
      default: 'trial'
    },
    trialEndsAt: {
      type: Date,
      default: () => new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) // 14 days trial
    },
    billingCycle: {
      type: String,
      enum: ['monthly', 'yearly'],
      default: 'monthly'
    },
    nextBillingDate: {
      type: Date,
      default: null
    },
    paypalSubscriptionId: {
      type: String,
      default: null
    }
  },
  limits: {
    maxUsers: {
      type: Number,
      default: function() {
        const limits = {
          starter: 5,
          professional: 25,
          enterprise: 100
        };
        return limits[this.subscription.plan] || 5;
      }
    },
    maxDIDs: {
      type: Number,
      default: function() {
        const limits = {
          starter: 50,
          professional: 500,
          enterprise: 999999
        };
        return limits[this.subscription.plan] || 50;
      }
    },
    maxConcurrentCalls: {
      type: Number,
      default: function() {
        const limits = {
          starter: 10,
          professional: 100,
          enterprise: 999999
        };
        return limits[this.subscription.plan] || 10;
      }
    },
    apiCallsPerMonth: {
      type: Number,
      default: function() {
        const limits = {
          starter: 10000,
          professional: 100000,
          enterprise: 999999
        };
        return limits[this.subscription.plan] || 10000;
      }
    }
  },
  settings: {
    timezone: {
      type: String,
      default: 'UTC'
    },
    defaultRotationStrategy: {
      type: String,
      enum: ['round-robin', 'least-used', 'performance-based', 'geographic'],
      default: 'round-robin'
    },
    complianceMode: {
      type: Boolean,
      default: true
    },
    dataRetentionDays: {
      type: Number,
      default: 365
    },
    allowApiAccess: {
      type: Boolean,
      default: true
    },
    defaultDidCapacity: {
      type: Number,
      default: 100,
      min: 1,
      max: 10000
    }
  },
  apiKeys: [{
    name: {
      type: String,
      required: true
    },
    key: {
      type: String,
      required: true
    },
    permissions: [{
      type: String,
      enum: ['read', 'write', 'admin']
    }],
    isActive: {
      type: Boolean,
      default: true
    },
    lastUsed: {
      type: Date,
      default: null
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  billing: {
    companyName: String,
    address: {
      street: String,
      city: String,
      state: String,
      zipCode: String,
      country: String
    },
    taxId: String,
    paymentMethod: {
      type: String,
      enum: ['paypal', 'stripe', 'manual'],
      default: 'paypal'
    }
  },
  usage: {
    currentPeriodStart: {
      type: Date,
      default: Date.now
    },
    currentPeriodEnd: {
      type: Date,
      default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
    },
    apiCallsThisMonth: {
      type: Number,
      default: 0
    },
    totalCallsThisMonth: {
      type: Number,
      default: 0
    }
  },
  rotationState: {
    currentIndex: {
      type: Number,
      default: 0
    },
    lastReset: {
      type: Date,
      default: Date.now
    },
    usedDidsInCycle: [{
      type: String
    }]
  }
}, {
  timestamps: true,
  toJSON: {
    transform: function(doc, ret) {
      // Don't expose API keys in JSON output
      if (ret.apiKeys) {
        ret.apiKeys = ret.apiKeys.map(key => ({
          ...key,
          key: key.key.substring(0, 8) + '...'
        }));
      }
      return ret;
    }
  }
});

// Indexes for efficient queries (subdomain and domain already indexed via unique: true)
tenantSchema.index({ 'subscription.status': 1 });

// Virtual for active user count
tenantSchema.virtual('activeUserCount', {
  ref: 'User',
  localField: '_id',
  foreignField: 'tenantId',
  count: true,
  match: { isActive: true }
});

// Virtual for active DID count
tenantSchema.virtual('activeDIDCount', {
  ref: 'DID',
  localField: '_id',
  foreignField: 'tenantId',
  count: true,
  match: { isActive: true }
});

// Instance method to check if tenant can add more users
tenantSchema.methods.canAddUser = function() {
  return this.activeUserCount < this.limits.maxUsers;
};

// Instance method to check if tenant can add more DIDs
tenantSchema.methods.canAddDID = function() {
  return this.activeDIDCount < this.limits.maxDIDs;
};

// Instance method to check if subscription is active
tenantSchema.methods.isSubscriptionActive = function() {
  if (this.subscription.status === 'trial') {
    return this.subscription.trialEndsAt > new Date();
  }
  return this.subscription.status === 'active';
};

// Instance method to generate API key
tenantSchema.methods.generateApiKey = async function(name, permissions = ['read']) {
  const crypto = await import('crypto');
  const key = 'did_' + crypto.randomBytes(32).toString('hex');
  
  this.apiKeys.push({
    name,
    key,
    permissions,
    isActive: true
  });
  
  return this.save().then(() => key);
};

// Static method to find by subdomain
tenantSchema.statics.findBySubdomain = function(subdomain) {
  return this.findOne({ subdomain, isActive: true });
};

// Static method to find by domain
tenantSchema.statics.findByDomain = function(domain) {
  return this.findOne({ domain, isActive: true });
};

// Pre-save middleware to update limits based on plan
tenantSchema.pre('save', function(next) {
  if (this.isModified('subscription.plan')) {
    const limits = {
      starter: { maxUsers: 5, maxDIDs: 50, maxConcurrentCalls: 10, apiCallsPerMonth: 10000 },
      professional: { maxUsers: 25, maxDIDs: 500, maxConcurrentCalls: 100, apiCallsPerMonth: 100000 },
      enterprise: { maxUsers: 100, maxDIDs: 999999, maxConcurrentCalls: 999999, apiCallsPerMonth: 999999 }
    };
    
    const planLimits = limits[this.subscription.plan];
    if (planLimits) {
      Object.assign(this.limits, planLimits);
    }
  }
  next();
});

const Tenant = mongoose.model('Tenant', tenantSchema);

export default Tenant;