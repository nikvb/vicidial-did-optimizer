import mongoose from 'mongoose';

// Audit ledger for the prepaid credit balance (Tenant.billing.creditBalanceCents).
// Every balance mutation writes one row: positive amountCents = credit added,
// negative = credit consumed. balanceAfterCents snapshots the result so the
// ledger is reconcilable without replaying.
const creditTransactionSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: ['topup_card', 'topup_usdt', 'invoice_applied', 'invoice_refund', 'admin_adjust'],
    required: true
  },
  amountCents: {
    type: Number,
    required: true
  },
  balanceAfterCents: {
    type: Number,
    required: true
  },
  // What this ties back to: PayPal capture id, TRON tx hash, invoice number,
  // or admin email for manual adjustments.
  reference: {
    type: String,
    default: null
  },
  notes: String
}, {
  timestamps: true
});

creditTransactionSchema.index({ tenantId: 1, createdAt: -1 });

const CreditTransaction = mongoose.model('CreditTransaction', creditTransactionSchema);

export default CreditTransaction;
