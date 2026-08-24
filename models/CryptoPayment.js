import mongoose from 'mongoose';

// A USDT (TRC-20) deposit intent. Created when the user opens the Add Funds
// USDT tab; the frontend polls check-payment which flips pending → credited
// atomically when a matching on-chain transfer appears on TronGrid.
const cryptoPaymentSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true,
    index: true
  },
  tronAddress: {
    type: String,
    required: true
  },
  // What the user said they'd send (USD). A transfer >= 99% of this matches.
  amountUsd: {
    type: Number,
    required: true
  },
  // What actually arrived on-chain (USDT), set at crediting time.
  amountUsdt: {
    type: Number,
    default: null
  },
  // Unique across all payments — the same on-chain transfer can never credit
  // two deposit intents. NO default: a sparse index still indexes explicit
  // nulls, so the field must stay absent until crediting sets it.
  txHash: {
    type: String,
    unique: true,
    sparse: true
  },
  status: {
    type: String,
    enum: ['pending', 'credited', 'expired'],
    default: 'pending',
    index: true
  },
  creditedAt: Date
}, {
  timestamps: true
});

cryptoPaymentSchema.index({ tenantId: 1, createdAt: -1 });

const CryptoPayment = mongoose.model('CryptoPayment', cryptoPaymentSchema);

export default CryptoPayment;
