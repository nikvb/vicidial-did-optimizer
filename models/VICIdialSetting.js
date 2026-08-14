import mongoose from 'mongoose';

const VICIdialSettingSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: true,
    // Unique index declared explicitly below — don't duplicate.
  },
  hostname: {
    type: String,
    required: true,
    trim: true,
  },
  username: {
    type: String,
    required: true,
    trim: true,
  },
  password: {
    type: String,
    required: true,
    // Note: Password stored in plain text because VICIdial API requires it
    // (codebase has no shared encryption-at-rest utility today; following
    // existing convention for VICIdial creds).
  },

  // ---------- DID inventory sync (added) ----------
  // Toggles auto-sync; manual sync via endpoint always works regardless.
  didSyncEnabled: {
    type: Boolean,
    default: false,
  },
  // How often the cron loop is allowed to re-sync this tenant (in minutes).
  // The cron itself ticks more frequently and skips tenants whose
  // lastDidSyncAt is newer than `now - didSyncIntervalMinutes`.
  didSyncIntervalMinutes: {
    type: Number,
    default: 60,
    min: 5,
    max: 1440,
  },
  // Sync strategy. See services/vicidial-sync-service.js for details.
  //   'did_log_discovery' (default) — uses did_log_export to derive DIDs
  //                                   from inbound call log over a lookback window.
  //   'api_list'                    — uses a configurable list function (only
  //                                   present in some VICIdial forks).
  didSyncMode: {
    type: String,
    enum: ['did_log_discovery', 'api_list'],
    default: 'did_log_discovery',
  },
  // For did_log_discovery: how many days of call log to scan.
  didSyncLookbackDays: {
    type: Number,
    default: 30,
    min: 1,
    max: 365,
  },
  // For api_list: name of the non_agent_api.php function that returns DIDs.
  // Canonical VICIdial 2.14+ does NOT ship one; customer must supply if a
  // custom fork exposes one (e.g. 'did_list', 'list_dids', 'in_dids_export').
  didSyncApiListFunction: {
    type: String,
    default: '',
    trim: true,
  },
  // Operational state — populated by the sync service.
  lastDidSyncAt: { type: Date, default: null },
  lastDidSyncStatus: {
    type: String,
    enum: ['success', 'partial', 'failed', null],
    default: null,
  },
  lastDidSyncMessage: { type: String, default: '' },
  lastDidSyncCounts: {
    fetched: { type: Number, default: 0 },
    added:   { type: Number, default: 0 },
    updated: { type: Number, default: 0 },
    deactivated: { type: Number, default: 0 },
    unchanged: { type: Number, default: 0 },
  },
}, {
  timestamps: true,
});

// One setting per tenant
VICIdialSettingSchema.index({ tenantId: 1 }, { unique: true });
// Cron needs a fast scan of enabled tenants overdue for a sync.
VICIdialSettingSchema.index({ didSyncEnabled: 1, lastDidSyncAt: 1 });

const VICIdialSetting = mongoose.model('VICIdialSetting', VICIdialSettingSchema);

export default VICIdialSetting;
