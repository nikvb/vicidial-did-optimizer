import mongoose from 'mongoose';

const CampaignSchema = new mongoose.Schema({
  // VICIdial campaign fields
  campaignId: {
    type: String,
    required: true,
    index: true,
    trim: true,
  },
  campaignName: {
    type: String,
    required: true,
    trim: true,
  },
  active: {
    type: String,
    enum: ['Y', 'N'],
    default: 'Y',
  },
  userGroup: {
    type: String,
    trim: true,
  },
  dialMethod: {
    type: String,
    trim: true,
  },
  dialLevel: {
    type: Number,
  },
  leadOrder: {
    type: String,
    trim: true,
  },
  dialStatuses: {
    type: String,
    trim: true,
  },

  // Tenant association
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true,
  },

  // Sync metadata
  lastSyncedAt: {
    type: Date,
    default: Date.now,
  },
  syncSource: {
    type: String,
    enum: ['api', 'manual'],
    default: 'api',
  },

  // Additional metadata
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },

  // DID Pool Configuration
  didPool: {
    enabled: {
      type: Boolean,
      default: false
    },
    poolId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CampaignDIDPool'
    },
    rotationStrategy: {
      type: {
        type: String,
        enum: ['round-robin', 'least-used', 'performance-based', 'geographic'],
        default: 'round-robin'
      },
      config: mongoose.Schema.Types.Mixed
    },
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
        trim: true
      }
    }
  }
}, {
  timestamps: true,
});

// Index for tenant-specific queries (compound unique — one campaignId per tenant)
CampaignSchema.index({ tenantId: 1, campaignId: 1 }, { unique: true });
CampaignSchema.index({ tenantId: 1, active: 1 });

const Campaign = mongoose.model('Campaign', CampaignSchema);

export default Campaign;
