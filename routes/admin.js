// Admin management API — users (roles/status) + tenant billing controls.
// Everything here requires an authenticated ADMIN (requireAdmin).
import express from 'express';
import { body, validationResult } from 'express-validator';
import User from '../models/User.js';
import Tenant from '../models/Tenant.js';
import { asyncHandler, createError } from '../middleware/errorHandler.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = express.Router();
router.use(authenticate, requireAdmin);

// =====================================================
// USERS
// =====================================================

// @desc    List all users with tenant names
// @route   GET /api/v1/admin/users
router.get('/users', asyncHandler(async (req, res) => {
  const users = await User.find({}, 'email firstName lastName role isActive tenant createdAt lastLogin')
    .populate('tenant', 'name subscription.status')
    .sort({ createdAt: -1 })
    .lean();

  res.json({
    success: true,
    data: {
      users: users.map(u => ({
        id: u._id,
        email: u.email,
        name: `${u.firstName || ''} ${u.lastName || ''}`.trim(),
        role: u.role,
        isActive: u.isActive,
        tenantName: u.tenant?.name || null,
        tenantStatus: u.tenant?.subscription?.status || null,
        createdAt: u.createdAt,
        lastLogin: u.lastLogin || null
      }))
    }
  });
}));

// @desc    Change a user's role
// @route   PUT /api/v1/admin/users/:id/role
router.put('/users/:id/role', [
  body('role').isIn(['CLIENT', 'ADMIN', 'RESELLER']).withMessage('role must be CLIENT, ADMIN, or RESELLER')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) throw createError.badRequest(errors.array()[0].msg);

  if (req.params.id === req.user._id.toString()) {
    throw createError.badRequest('You cannot change your own role (prevents locking yourself out)');
  }

  const user = await User.findById(req.params.id);
  if (!user) throw createError.notFound('User not found');

  const oldRole = user.role;
  user.role = req.body.role;
  await user.save();

  console.log(`👤 Admin ${req.user.email}: ${user.email} role ${oldRole} → ${user.role}`);
  res.json({ success: true, data: { id: user._id, email: user.email, role: user.role } });
}));

// @desc    Activate / deactivate a user
// @route   PUT /api/v1/admin/users/:id/status
router.put('/users/:id/status', [
  body('isActive').isBoolean().withMessage('isActive must be boolean')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) throw createError.badRequest(errors.array()[0].msg);

  if (req.params.id === req.user._id.toString()) {
    throw createError.badRequest('You cannot deactivate your own account');
  }

  const user = await User.findById(req.params.id);
  if (!user) throw createError.notFound('User not found');

  user.isActive = req.body.isActive;
  await user.save();

  console.log(`👤 Admin ${req.user.email}: ${user.email} isActive → ${user.isActive}`);
  res.json({ success: true, data: { id: user._id, email: user.email, isActive: user.isActive } });
}));

// =====================================================
// TENANT BILLING CONTROLS
// =====================================================

// @desc    Set tenant subscription status (manual suspend/reactivate/trial)
// @route   PUT /api/v1/admin/tenants/:id/status
router.put('/tenants/:id/status', [
  body('status').isIn(['active', 'trial', 'suspended', 'cancelled']).withMessage('invalid status'),
  body('reason').optional().isString().isLength({ max: 200 })
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) throw createError.badRequest(errors.array()[0].msg);

  const tenant = await Tenant.findById(req.params.id);
  if (!tenant) throw createError.notFound('Tenant not found');

  const { status, reason } = req.body;
  const oldStatus = tenant.subscription.status;
  tenant.subscription.status = status;

  if (status === 'suspended') {
    tenant.subscription.gracePeriod.suspendedAt = new Date();
    tenant.subscription.gracePeriod.suspensionReason = reason || 'admin_manual';
    tenant.isActive = false;
  } else {
    tenant.isActive = true;
    if (status === 'active') {
      tenant.subscription.gracePeriod.currentFailedPayments = 0;
      tenant.subscription.gracePeriod.suspendedAt = null;
      tenant.subscription.gracePeriod.suspensionReason = null;
    }
  }
  await tenant.save();

  console.log(`🏢 Admin ${req.user.email}: ${tenant.name} status ${oldStatus} → ${status}${reason ? ` (${reason})` : ''}`);
  res.json({ success: true, data: { tenantId: tenant._id, name: tenant.name, oldStatus, status } });
}));

// @desc    Extend (or set) a tenant's trial by N days from now
// @route   PUT /api/v1/admin/tenants/:id/trial
router.put('/tenants/:id/trial', [
  body('days').isInt({ min: 1, max: 365 }).withMessage('days must be 1-365')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) throw createError.badRequest(errors.array()[0].msg);

  const tenant = await Tenant.findById(req.params.id);
  if (!tenant) throw createError.notFound('Tenant not found');

  tenant.subscription.trialEndsAt = new Date(Date.now() + req.body.days * 24 * 60 * 60 * 1000);
  if (tenant.subscription.status !== 'active') {
    tenant.subscription.status = 'trial';
    tenant.isActive = true;
  }
  await tenant.save();

  console.log(`🏢 Admin ${req.user.email}: ${tenant.name} trial extended to ${tenant.subscription.trialEndsAt.toISOString().slice(0, 10)}`);
  res.json({ success: true, data: { tenantId: tenant._id, trialEndsAt: tenant.subscription.trialEndsAt, status: tenant.subscription.status } });
}));

// @desc    Toggle auto-pay for a tenant
// @route   PUT /api/v1/admin/tenants/:id/autopay
router.put('/tenants/:id/autopay', [
  body('enabled').isBoolean().withMessage('enabled must be boolean')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) throw createError.badRequest(errors.array()[0].msg);

  const tenant = await Tenant.findById(req.params.id);
  if (!tenant) throw createError.notFound('Tenant not found');

  tenant.billing.autoPayEnabled = req.body.enabled;
  await tenant.save();
  res.json({ success: true, data: { tenantId: tenant._id, autoPayEnabled: tenant.billing.autoPayEnabled } });
}));

// @desc    Grant, adjust, or revoke a promo rate for a tenant
// @route   POST /api/v1/admin/tenants/:id/promo
//          { rate, months, label? }  → grant/replace
//          { revoke: true }          → remove promo
router.post('/tenants/:id/promo', [
  body('revoke').optional().isBoolean(),
  body('rate').optional().isFloat({ min: 0 }),
  body('months').optional().isInt({ min: 1, max: 36 }),
  body('label').optional().isString().isLength({ max: 40 })
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) throw createError.badRequest(errors.array()[0].msg);

  const tenant = await Tenant.findById(req.params.id);
  if (!tenant) throw createError.notFound('Tenant not found');

  if (req.body.revoke) {
    tenant.subscription.promo = { rate: null, endsAt: null, label: null };
    await tenant.save();
    console.log(`🎁 Admin ${req.user.email}: promo revoked for ${tenant.name}`);
    return res.json({ success: true, data: { tenantId: tenant._id, promo: null } });
  }

  const { rate, months, label } = req.body;
  if (rate == null || months == null) {
    throw createError.badRequest('Provide { rate, months } to grant a promo, or { revoke: true } to remove');
  }

  const endsAt = new Date();
  endsAt.setMonth(endsAt.getMonth() + months);
  tenant.subscription.promo = { rate: +rate, endsAt, label: label || 'admin_grant' };
  await tenant.save();

  console.log(`🎁 Admin ${req.user.email}: promo $${rate}/DID x ${months}mo granted to ${tenant.name}`);
  res.json({ success: true, data: { tenantId: tenant._id, promo: tenant.subscription.promo } });
}));

export default router;
