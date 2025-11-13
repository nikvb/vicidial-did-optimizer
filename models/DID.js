import mongoose from 'mongoose';

const didSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true,
    index: true
  },
  phoneNumber: {
    type: String,
    required: true,
    trim: true,
    match: /^[\+]?[1-9][\d\s\-()]*$/ // Flexible phone number format
  },
  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  },
  capacity: {
    type: Number,
    default: () => parseInt(process.env.DEFAULT_DID_CAPACITY || '100', 10),
    min: 1
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  isActive: {
    type: Boolean,
    default: true
  },

  // Geographic location data (enhanced with NPANXX support)
  location: {
    latitude: Number,
    longitude: Number,
    state: String,
    areaCode: String,
    city: String,
    zipCode: String,
    // NPANXX specific fields
    country: {
      type: String,
      default: 'US'
    },
    coordinates: {
      type: [Number], // [longitude, latitude] format for GeoJSON compatibility
      index: '2dsphere'
    },
    source: {
      type: String,
      enum: ['NPANXX', 'Manual', 'Import', 'Unknown'],
      default: 'Unknown'
    },
    updatedAt: {
      type: Date,
      default: Date.now
    }
  },

  // Usage tracking (flexible schema)
  usage: {
    totalCalls: {
      type: Number,
      default: 0
    },
    dailyUsage: [{
      date: Date,
      count: Number
    }],
    lastUsed: Date,
    lastCampaign: String,
    lastAgent: String
  },

  // Performance metrics (flexible schema)
  metrics: {
    totalAnswered: {
      type: Number,
      default: 0
    },
    totalConnected: {
      type: Number,
      default: 0
    },
    totalDropped: {
      type: Number,
      default: 0
    },
    totalFailed: {
      type: Number,
      default: 0
    },
    totalBusy: {
      type: Number,
      default: 0
    },
    totalDuration: {
      type: Number,
      default: 0
    },
    lastCallResult: String,
    lastCallTimestamp: Date
  },

  // Usage history for detailed tracking
  usageHistory: [{
    campaign: String,
    agent: String,
    timestamp: Date,
    result: String,
    duration: Number,
    disposition: String,
    metadata: mongoose.Schema.Types.Mixed
  }],

  // Reputation data - matches actual database structure
  reputation: {
    score: {
      type: Number,
      min: 0,
      max: 100,
      default: 50
    },
    status: {
      type: String,
      enum: ['Unknown', 'Positive', 'Negative', 'Neutral'],
      default: 'Unknown'
    },
    lastChecked: Date,
    robokillerData: {
      userReports: Number,
      reputationStatus: String,
      totalCalls: mongoose.Schema.Types.Mixed, // Can be null
      lastCallDate: mongoose.Schema.Types.Mixed, // Can be null or string
      robokillerStatus: String,
      spamScore: mongoose.Schema.Types.Mixed, // Can be null
      callerName: mongoose.Schema.Types.Mixed, // Can be null or string
      location: mongoose.Schema.Types.Mixed, // Can be null or string
      carrier: mongoose.Schema.Types.Mixed, // Can be null or string
      commentsCount: Number
    }
  },

  // Additional metadata (flexible schema)
  metadata: {
    carrier: String,
    lineType: String,
    portedDate: Date,
    notes: String
  }
}, {
  timestamps: true,
  strict: false // Allow flexibility for existing data
});

// Compound indexes for efficient queries
didSchema.index({ tenantId: 1, status: 1 });
didSchema.index({ phoneNumber: 1, tenantId: 1 }, { unique: true });
didSchema.index({ tenantId: 1, 'location.state': 1 });
didSchema.index({ tenantId: 1, 'location.areaCode': 1 });
didSchema.index({ tenantId: 1, 'usage.lastUsed': 1 });
didSchema.index({ 'location.latitude': 1, 'location.longitude': 1 });

// Critical indexes for DID rotation and selection (for /api/v1/dids/next endpoint)
// This compound index supports the most common query: active DIDs with good reputation sorted by lastUsed
didSchema.index({ tenantId: 1, status: 1, 'reputation.score': 1, 'usage.lastUsed': 1 });
// Fallback index for queries without lastUsed sorting
didSchema.index({ tenantId: 1, status: 1, 'reputation.score': 1 });
// Index for daily usage filtering
didSchema.index({ 'usage.dailyUsage.date': 1 });

// Method to get today's usage count
didSchema.methods.getTodayUsage = function() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const todayUsage = this.usage.dailyUsage.find(day => {
    const dayDate = new Date(day.date);
    dayDate.setHours(0, 0, 0, 0);
    return dayDate.getTime() === today.getTime();
  });

  return todayUsage ? todayUsage.count : 0;
};

// Method to increment today's usage
didSchema.methods.incrementTodayUsage = function() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const todayUsage = this.usage.dailyUsage.find(day => {
    const dayDate = new Date(day.date);
    dayDate.setHours(0, 0, 0, 0);
    return dayDate.getTime() === today.getTime();
  });

  if (todayUsage) {
    todayUsage.count++;
  } else {
    this.usage.dailyUsage.push({
      date: today,
      count: 1
    });
  }

  // Keep only last 30 days of usage data
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  this.usage.dailyUsage = this.usage.dailyUsage.filter(day =>
    new Date(day.date) >= thirtyDaysAgo
  );
};

// Method to check if DID has reached daily limit
didSchema.methods.hasReachedDailyLimit = function(limit = 200) {
  return this.getTodayUsage() >= limit;
};

// Static method to calculate distance between two points using Haversine formula
didSchema.statics.calculateDistance = function(lat1, lon1, lat2, lon2) {
  const R = 3959; // Earth radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c; // Distance in miles
};

// Method to get distance from this DID to a target location
didSchema.methods.getDistanceFrom = function(latitude, longitude) {
  if (!this.location.latitude || !this.location.longitude) {
    return Infinity; // Return max distance if no coordinates
  }
  return this.constructor.calculateDistance(
    this.location.latitude,
    this.location.longitude,
    latitude,
    longitude
  );
};

// Pre-save middleware to automatically populate location data from NPANXX database
didSchema.pre('save', async function(next) {
  // Only populate location if it's a new document or phone number changed
  if (this.isNew || this.isModified('phoneNumber')) {
    try {
      // Import AreaCodeLocation here to avoid circular dependencies
      const AreaCodeLocation = mongoose.model('AreaCodeLocation');

      // Extract area code from phone number
      const extractAreaCode = (phoneNumber) => {
        if (!phoneNumber) return null;
        const cleanNumber = phoneNumber.replace(/\D/g, '');
        if (cleanNumber.length >= 10) {
          if (cleanNumber.startsWith('1') && cleanNumber.length === 11) {
            return cleanNumber.substring(1, 4);
          } else if (cleanNumber.length === 10) {
            return cleanNumber.substring(0, 3);
          }
        }
        return null;
      };

      const areaCode = extractAreaCode(this.phoneNumber);

      if (areaCode) {
        // Lookup location data from NPANXX database
        const locationData = await AreaCodeLocation.findOne({ areaCode });

        if (locationData) {
          // Only update if location data is not already set or source is not NPANXX
          if (!this.location || this.location.source !== 'NPANXX') {
            this.location = {
              ...this.location, // Preserve any existing manual data
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
      // Don't fail the save if location lookup fails
      console.warn('Failed to populate location data for DID:', this.phoneNumber, error.message);
    }
  }
  next();
});

const DID = mongoose.model('DID', didSchema);

export default DID;