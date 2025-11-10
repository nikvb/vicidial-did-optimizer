import mongoose from 'mongoose';

const invoiceSchema = new mongoose.Schema({
  invoiceNumber: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true,
    index: true
  },
  billingPeriod: {
    start: {
      type: Date,
      required: true
    },
    end: {
      type: Date,
      required: true
    }
  },
  subscription: {
    plan: {
      type: String,
      enum: ['basic', 'professional', 'enterprise'],
      required: true
    },
    baseFee: {
      type: Number,
      required: true
    },
    billingCycle: {
      type: String,
      enum: ['monthly', 'yearly'],
      required: true
    }
  },
  didCharges: {
    didCount: {
      type: Number,
      required: true,
      default: 0
    },
    includedDids: {
      type: Number,
      required: true
    },
    extraDids: {
      type: Number,
      required: true,
      default: 0
    },
    perDidRate: {
      type: Number,
      required: true
    },
    totalDidFee: {
      type: Number,
      required: true,
      default: 0
    }
  },
  amounts: {
    subtotal: {
      type: Number,
      required: true
    },
    tax: {
      type: Number,
      default: 0
    },
    total: {
      type: Number,
      required: true
    }
  },
  status: {
    type: String,
    enum: ['draft', 'pending', 'paid', 'failed', 'refunded', 'cancelled'],
    default: 'draft',
    index: true
  },
  paymentDetails: {
    provider: {
      type: String,
      enum: ['paypal', 'stripe', 'manual'],
      default: 'paypal'
    },
    transactionId: String,
    paypalOrderId: String,
    paypalSubscriptionId: String,
    paymentMethodId: mongoose.Schema.Types.ObjectId, // Reference to payment method used
    paidAt: Date,
    failedAt: Date,
    failureReason: String,
    retryCount: {
      type: Number,
      default: 0
    }
  },
  metadata: {
    generatedAt: {
      type: Date,
      default: Date.now
    },
    dueDate: {
      type: Date,
      required: true
    },
    pdfUrl: String,
    emailSentAt: Date,
    notes: String
  }
}, {
  timestamps: true
});

// Indexes for efficient queries
invoiceSchema.index({ invoiceNumber: 1 }, { unique: true });
invoiceSchema.index({ tenantId: 1, createdAt: -1 });
invoiceSchema.index({ status: 1 });
invoiceSchema.index({ 'billingPeriod.start': 1, 'billingPeriod.end': 1 });
invoiceSchema.index({ 'metadata.dueDate': 1 });

// Generate invoice number automatically
invoiceSchema.pre('save', async function(next) {
  if (this.isNew && !this.invoiceNumber) {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');

    // Count invoices in current month
    const count = await this.constructor.countDocuments({
      createdAt: {
        $gte: new Date(year, date.getMonth(), 1),
        $lt: new Date(year, date.getMonth() + 1, 1)
      }
    });

    this.invoiceNumber = `INV-${year}${month}-${String(count + 1).padStart(5, '0')}`;
  }
  next();
});

// Instance method to mark as paid
invoiceSchema.methods.markAsPaid = function(transactionId, paymentMethodId) {
  this.status = 'paid';
  this.paymentDetails.transactionId = transactionId;
  this.paymentDetails.paymentMethodId = paymentMethodId;
  this.paymentDetails.paidAt = new Date();
  return this.save();
};

// Instance method to mark as failed
invoiceSchema.methods.markAsFailed = function(reason) {
  this.status = 'failed';
  this.paymentDetails.failedAt = new Date();
  this.paymentDetails.failureReason = reason;
  this.paymentDetails.retryCount += 1;
  return this.save();
};

// Instance method to check if retry is allowed
invoiceSchema.methods.canRetry = function() {
  return this.status === 'failed' && this.paymentDetails.retryCount < 3;
};

// Instance method to calculate days overdue
invoiceSchema.methods.daysOverdue = function() {
  if (this.status === 'paid') return 0;
  const today = new Date();
  const dueDate = this.metadata.dueDate;
  if (today <= dueDate) return 0;
  return Math.floor((today - dueDate) / (1000 * 60 * 60 * 24));
};

// Static method to get unpaid invoices for tenant
invoiceSchema.statics.getUnpaidForTenant = function(tenantId) {
  return this.find({
    tenantId,
    status: { $in: ['pending', 'failed'] }
  }).sort({ 'metadata.dueDate': 1 });
};

// Static method to get invoices due for retry
invoiceSchema.statics.getDueForRetry = function() {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return this.find({
    status: 'failed',
    'paymentDetails.retryCount': { $lt: 3 },
    'paymentDetails.failedAt': { $gte: oneDayAgo }
  }).populate('tenantId');
};

// Virtual for formatted invoice number
invoiceSchema.virtual('formattedNumber').get(function() {
  return this.invoiceNumber;
});

// Virtual for is overdue
invoiceSchema.virtual('isOverdue').get(function() {
  return this.daysOverdue() > 0;
});

const Invoice = mongoose.model('Invoice', invoiceSchema);

export default Invoice;
