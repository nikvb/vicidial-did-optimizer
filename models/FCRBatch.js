import mongoose from 'mongoose';

// FCR submission batch — a snapshot of a .txt file we generated for a customer
// to upload to https://www.freecallerregistry.com. The customer downloads the
// file, submits it on FCR's HTML form, then comes back here and marks the
// batch as "submitted" (and later "approved" when FCR confirms via email).
const fcrBatchSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true,
    index: true
  },
  // Human-readable batch identifier, e.g. "FCR-2026-06-22-001"
  batchNumber: {
    type: String,
    required: true
  },
  // DIDs included in this batch (references)
  didIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DID'
  }],
  // Snapshot of the phone numbers we actually wrote to the file in FCR's
  // required +1XXXXXXXXXX format. Stored so the batch is self-contained
  // even if the underlying DIDs are later deleted/modified.
  phoneNumbers: [String],
  fileFormat: {
    type: String,
    default: 'txt'
  },
  fileSize: Number,
  status: {
    type: String,
    enum: ['generated', 'submitted', 'approved', 'rejected'],
    default: 'generated',
    index: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  generatedAt: {
    type: Date,
    default: Date.now
  },
  submittedAt: Date,
  approvedAt: Date,
  notes: String
}, {
  timestamps: true
});

// Per-tenant query patterns
fcrBatchSchema.index({ tenantId: 1, generatedAt: -1 });
fcrBatchSchema.index({ tenantId: 1, status: 1 });

const FCRBatch = mongoose.model('FCRBatch', fcrBatchSchema);

export default FCRBatch;
