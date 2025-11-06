import mongoose from 'mongoose';

const auditLogSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false // Can be null for system actions
  },
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tenant',
    required: false
  },
  action: {
    type: String,
    required: true,
    enum: [
      'user_login',
      'user_logout',
      'user_register',
      'user_update',
      'user_delete',
      'did_create',
      'did_update',
      'did_delete',
      'did_rotate',
      'api_key_create',
      'api_key_delete',
      'api_key_use',
      'tenant_create',
      'tenant_update',
      'rotation_rule_create',
      'rotation_rule_update',
      'rotation_rule_delete',
      'billing_update',
      'subscription_change',
      'settings_update',
      'api_call',
      'system_action',
      'CALL_RESULT_SYNCED'  // VICIdial call results sync
    ]
  },
  details: {
    type: mongoose.Schema.Types.Mixed, // Flexible object for action-specific details
    default: {}
  },
  ipAddress: {
    type: String,
    required: false
  },
  userAgent: {
    type: String,
    required: false
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true,
  collection: 'auditlogs'
});

// Indexes for common queries
auditLogSchema.index({ userId: 1, createdAt: -1 });
auditLogSchema.index({ tenantId: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ createdAt: -1 });

// Static method to log an action
auditLogSchema.statics.logAction = async function(data) {
  try {
    const log = new this(data);
    await log.save();
    return log;
  } catch (error) {
    console.error('Failed to log audit action:', error);
    return null;
  }
};

// Static method to get user activity
auditLogSchema.statics.getUserActivity = async function(userId, limit = 10) {
  return this.find({ userId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
};

// Static method to get tenant activity
auditLogSchema.statics.getTenantActivity = async function(tenantId, limit = 10) {
  return this.find({ tenantId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('userId', 'email firstName lastName')
    .lean();
};

const AuditLog = mongoose.model('AuditLog', auditLogSchema);

export default AuditLog;