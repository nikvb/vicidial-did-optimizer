import mongoose from 'mongoose';

const resellerSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  slug: {
    type: String,
    unique: true,
    sparse: true,
    lowercase: true,
    trim: true,
    match: /^[a-z0-9-]+$/
  },
  ownerUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  status: {
    type: String,
    enum: ['active', 'suspended', 'cancelled'],
    default: 'active',
    index: true
  },
  // Negotiated wholesale per-DID rate; null = pricingCurves.RESELLER_RATE
  customRate: {
    type: Number,
    default: null
  },
  brandingConfig: {
    logoUrl: { type: String, default: null },
    primaryColor: { type: String, default: '#06b6d4' },
    productName: { type: String, default: null },
    supportEmail: { type: String, default: null }
  },
  defaultClientLimits: {
    maxUsers: { type: Number, default: 25 },
    maxDIDs: { type: Number, default: 10000 }
  },
  billing: {
    autoPayEnabled: { type: Boolean, default: true },
    paymentMethods: [{
      type: { type: String, enum: ['paypal_account', 'credit_card', 'debit_card'], required: true },
      isPrimary: { type: Boolean, default: false },
      vaultId: { type: String, required: true },
      last4: String,
      cardType: String,
      expiryMonth: Number,
      expiryYear: Number,
      isActive: { type: Boolean, default: true },
      addedAt: { type: Date, default: Date.now },
      lastUsedAt: Date
    }],
    lastInvoiceDate: Date,
    totalPaid: { type: Number, default: 0 },
    totalOutstanding: { type: Number, default: 0 },
    failedPaymentCount: { type: Number, default: 0 }
  }
}, {
  timestamps: true,
  toJSON: {
    transform: function(doc, ret) {
      if (ret.billing && Array.isArray(ret.billing.paymentMethods)) {
        ret.billing.paymentMethods = ret.billing.paymentMethods.map(pm => ({
          ...pm,
          vaultId: pm.vaultId ? '***' + String(pm.vaultId).slice(-4) : null
        }));
      }
      return ret;
    }
  }
});

resellerSchema.index({ status: 1 });

resellerSchema.virtual('clientTenants', {
  ref: 'Tenant',
  localField: '_id',
  foreignField: 'resellerId'
});

resellerSchema.methods.getPrimaryPaymentMethod = function() {
  return (this.billing.paymentMethods || []).find(pm => pm.isPrimary && pm.isActive);
};

const Reseller = mongoose.model('Reseller', resellerSchema);
export default Reseller;
