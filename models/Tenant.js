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
  resellerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Reseller',
    default: null,
    index: true
  },
  subscription: {
    plan: {
      // payg = pay-as-you-go (stepped curve, default for everyone)
      // annual = curve charged 12 months upfront for the price of 10
      // enterprise = hand-priced (uses subscription.perDidPricing.customRate)
      // basic/professional kept for legacy DB rows; treated as 'payg' at billing time.
      type: String,
      enum: ['payg', 'annual', 'enterprise', 'basic', 'professional'],
      default: 'payg'
    },
    status: {
      type: String,
      enum: ['active', 'cancelled', 'suspended', 'trial'],
      default: 'trial'
    },
    // Rate class for flat per-DID pricing (pricingCurves.FLAT_RATES):
    // 'provided' = we source the DIDs ($0.15/DID/mo)
    // 'byo'      = tenant brings their own DIDs, service only ($0.10/DID/mo)
    // Assigned per tenant by an admin; perDidPricing.customRate overrides both.
    didSource: {
      type: String,
      enum: ['provided', 'byo'],
      default: 'byo'
    },
    // Time-boxed promotional rate (e.g. early-adopter: first 10 activated
    // clients get $0.03/BYO-DID for 3 months). Ignored once endsAt passes.
    // Precedence at billing time: perDidPricing.customRate > active promo > flat rate.
    promo: {
      rate: { type: Number, default: null },
      endsAt: { type: Date, default: null },
      label: { type: String, default: null }
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
    },
    perDidPricing: {
      enabled: {
        type: Boolean,
        default: true
      },
      customRate: {
        type: Number,
        default: null // For enterprise custom pricing
      }
    },
    gracePeriod: {
      enabled: {
        type: Boolean,
        default: true
      },
      daysAllowed: {
        type: Number,
        default: 7
      },
      currentFailedPayments: {
        type: Number,
        default: 0
      },
      suspendedAt: Date,
      suspensionReason: String
    }
  },
  limits: {
    maxUsers: {
      type: Number,
      default: function() {
        const limits = {
          basic: 5,
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
          basic: 250,
          professional: 1000,
          enterprise: 999999
        };
        return limits[this.subscription.plan] || 250;
      }
    },
    maxConcurrentCalls: {
      type: Number,
      default: function() {
        const limits = {
          basic: 10,
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
          basic: 10000,
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
    },
    mlSelector: {
      enabled: {
        type: Boolean,
        default: false
      },
      controlBucketPct: {
        type: Number,
        default: 5,
        min: 0,
        max: 100
      },
      modelVersion: {
        type: String,
        default: null
      },
      shadowOnly: {
        type: Boolean,
        default: true
      }
    },
    // ── FAS Probe Budget ─────────────────────────────────────────────────
    // After a DID's 7-day FAS rest expires, the graduation cron moves it
    // into probation: the selector can pick it but is capped to this budget
    // over the probe window (24h). The grad cron then measures the resulting
    // FAS rate and either releases the DID or re-rests with an escalating
    // window. After `maxProbeAttempts` failed cycles the DID is permanently
    // burned (set to a 100-year rest).
    probeBudget: {
      enabled: {
        type: Boolean,
        default: true
      },
      callsPerWindow: {
        type: Number,
        default: 30,
        min: 10,
        max: 200
      },
      maxProbeAttempts: {
        type: Number,
        default: 3,
        min: 1,
        max: 10
      },
      // FAS rate (0..1) above which probe fails. If null, the grad cron
      // falls back to the tenant's MAX(p90*1.5, 0.02) baseline (same rule
      // as fas_rest_tagger).
      failThreshold: {
        type: Number,
        default: null,
        min: 0,
        max: 1
      }
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
    emailForInvoices: String,
    autoPayEnabled: {
      type: Boolean,
      default: true
    },
    lastInvoiceDate: Date,
    totalPaid: {
      type: Number,
      default: 0
    },
    totalOutstanding: {
      type: Number,
      default: 0
    },
    paymentMethods: [{
      type: {
        type: String,
        enum: ['paypal_account', 'credit_card', 'debit_card'],
        required: true
      },
      isPrimary: {
        type: Boolean,
        default: false
      },
      vaultId: {
        type: String, // PayPal vault token
        required: true
      },
      last4: String, // Last 4 digits of card
      cardType: String, // visa, mastercard, amex, discover
      expiryMonth: Number,
      expiryYear: Number,
      billingAddress: {
        name: String,
        street: String,
        city: String,
        state: String,
        zipCode: String,
        country: String
      },
      isActive: {
        type: Boolean,
        default: true
      },
      addedAt: {
        type: Date,
        default: Date.now
      },
      lastUsedAt: Date
    }]
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
  },
  // ── Free Caller Registry (FCR) profile ────────────────────────────────
  // Business profile a customer pastes into the FCR submission form at
  // https://www.freecallerregistry.com. We store it once so they don't
  // re-enter it every batch. We never submit on their behalf — the customer
  // copies these fields into the FCR HTML form along with the .txt file we
  // generate.
  fcrProfile: {
    businessName: String,
    address: {
      street: String,
      city: String,
      state: String,
      zip: String
    },
    website: String,
    contact: {
      name: String,
      phone: String,
      email: String
    },
    callPurpose: String,
    monthlyCallVolume: Number,
    configuredAt: Date,
    updatedAt: Date
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

// Pre-save: PAYG/annual/enterprise all share generous limits — pricing is
// per-DID, not gated by plan tier. We only auto-bump limits if migrating off
// a legacy basic/professional plan, never auto-shrink.
tenantSchema.pre('save', function(next) {
  if (this.isModified('subscription.plan')) {
    const newPlanLimits = { maxUsers: 100, maxDIDs: 999999, maxConcurrentCalls: 999999, apiCallsPerMonth: 999999 };
    const newPlans = ['payg', 'annual', 'enterprise'];
    if (newPlans.includes(this.subscription.plan)) {
      Object.assign(this.limits, newPlanLimits);
    }
  }
  next();
});

// Instance method to get primary payment method
tenantSchema.methods.getPrimaryPaymentMethod = function() {
  return this.billing.paymentMethods.find(pm => pm.isPrimary && pm.isActive);
};

// Instance method to add payment method
tenantSchema.methods.addPaymentMethod = function(paymentMethodData) {
  // If this is the first payment method, make it primary
  if (this.billing.paymentMethods.length === 0) {
    paymentMethodData.isPrimary = true;
  }
  this.billing.paymentMethods.push(paymentMethodData);
  return this.save();
};

const Tenant = mongoose.model('Tenant', tenantSchema);

export default Tenant;