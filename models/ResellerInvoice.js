import mongoose from 'mongoose';

const resellerInvoiceSchema = new mongoose.Schema({
  invoiceNumber: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  resellerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Reseller',
    required: true,
    index: true
  },
  billingPeriod: {
    start: { type: Date, required: true },
    end:   { type: Date, required: true }
  },
  // Per-client-tenant DID counts at the time of billing.
  clientBreakdown: [{
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant' },
    tenantName: String,
    didCount: Number
  }],
  // Marginal-rate tier breakdown (output of calculateResellerCharge.breakdown).
  tierBreakdown: [{
    from: Number,
    to: Number,
    rate: Number,
    didsInTier: Number,
    subtotal: Number
  }],
  totalDids: { type: Number, required: true, default: 0 },
  amounts: {
    subtotal: { type: Number, required: true },
    tax:      { type: Number, default: 0 },
    total:    { type: Number, required: true }
  },
  status: {
    type: String,
    enum: ['draft', 'pending', 'paid', 'failed', 'refunded', 'cancelled'],
    default: 'pending',
    index: true
  },
  paymentDetails: {
    provider: { type: String, enum: ['paypal', 'stripe', 'manual'], default: 'paypal' },
    transactionId: String,
    paymentMethodId: mongoose.Schema.Types.ObjectId,
    paidAt: Date,
    failedAt: Date,
    failureReason: String,
    retryCount: { type: Number, default: 0 }
  },
  metadata: {
    generatedAt: { type: Date, default: Date.now },
    dueDate:     { type: Date, required: true },
    notes: String
  }
}, { timestamps: true });

resellerInvoiceSchema.index({ resellerId: 1, createdAt: -1 });
resellerInvoiceSchema.index({ 'billingPeriod.start': 1, 'billingPeriod.end': 1 });

resellerInvoiceSchema.pre('validate', async function(next) {
  if (this.isNew && !this.invoiceNumber) {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const count = await this.constructor.countDocuments({
      createdAt: {
        $gte: new Date(year, date.getMonth(), 1),
        $lt:  new Date(year, date.getMonth() + 1, 1)
      }
    });
    this.invoiceNumber = `DIDS-AMDY-R-${year}${month}-${String(count + 1).padStart(5, "0")}`;
  }
  next();
});

resellerInvoiceSchema.methods.markAsPaid = function(transactionId, paymentMethodId) {
  this.status = 'paid';
  this.paymentDetails.transactionId = transactionId;
  this.paymentDetails.paymentMethodId = paymentMethodId;
  this.paymentDetails.paidAt = new Date();
  return this.save();
};

resellerInvoiceSchema.methods.markAsFailed = function(reason) {
  this.status = 'failed';
  this.paymentDetails.failedAt = new Date();
  this.paymentDetails.failureReason = reason;
  this.paymentDetails.retryCount = (this.paymentDetails.retryCount || 0) + 1;
  return this.save();
};

const ResellerInvoice = mongoose.model('ResellerInvoice', resellerInvoiceSchema);
export default ResellerInvoice;
