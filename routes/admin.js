// Admin management API — users (roles/status) + tenant billing controls.
// Everything here requires an authenticated ADMIN (requireAdmin).
import express from 'express';
import { body, validationResult } from 'express-validator';
import User from '../models/User.js';
import Tenant from '../models/Tenant.js';
import Invoice from '../models/Invoice.js';
import AuditLog from '../models/AuditLog.js';
import DID from '../models/DID.js';
import CryptoPayment from '../models/CryptoPayment.js';
import { asyncHandler, createError } from '../middleware/errorHandler.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { creditTenant, deductCredit } from '../services/billing/creditService.js';
import { getUsdtBalance, sweepTenantUsdt } from '../services/billing/tronWallet.js';
import { getEffectiveRate } from '../services/billing/billingService.js';

const router = express.Router();
router.use(authenticate, requireAdmin);

// =====================================================
// PLATFORM OVERVIEW
// =====================================================

// @desc    Billing-focused platform overview for the admin dashboard
// @route   GET /api/v1/admin/overview
router.get('/overview', asyncHandler(async (req, res) => {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [tenants, userCounts, invoiceAgg, monthAgg, recentTenants] = await Promise.all([
    Tenant.find({}, 'name subscription billing.creditBalanceCents billing.paymentMethods createdAt').lean(),
    User.aggregate([{ $group: { _id: '$isActive', n: { $sum: 1 } } }]),
    Invoice.aggregate([
      { $group: { _id: '$status', n: { $sum: 1 }, amount: { $sum: '$amounts.total' } } }
    ]),
    Invoice.aggregate([
      { $match: { status: 'paid', 'paymentDetails.paidAt': { $gte: monthStart } } },
      { $group: { _id: null, n: { $sum: 1 }, amount: { $sum: '$amounts.total' } } }
    ]),
    Tenant.find({}, 'name subscription.status createdAt').sort({ createdAt: -1 }).limit(5).lean()
  ]);

  // Billable DIDs per tenant in one aggregation (avoids N queries)
  const didCounts = await DID.aggregate([
    { $match: { status: 'active', isActive: true } },
    { $group: { _id: '$tenantId', n: { $sum: 1 } } }
  ]);
  const didByTenant = Object.fromEntries(didCounts.map(d => [String(d._id), d.n]));

  const statusCounts = { active: 0, trial: 0, suspended: 0, cancelled: 0 };
  let projectedMrr = 0, totalBillableDids = 0, totalCreditCents = 0, withCard = 0;
  for (const t of tenants) {
    const status = t.subscription?.status || 'trial';
    statusCounts[status] = (statusCounts[status] || 0) + 1;
    totalCreditCents += t.billing?.creditBalanceCents || 0;
    if ((t.billing?.paymentMethods || []).some(pm => pm.isActive)) withCard++;
    const dids = didByTenant[String(t._id)] || 0;
    totalBillableDids += dids;
    if (status === 'active') {
      projectedMrr += dids * getEffectiveRate(t).rate;
    }
  }

  const invByStatus = Object.fromEntries(invoiceAgg.map(i => [i._id, { count: i.n, amount: +i.amount.toFixed(2) }]));

  res.json({
    success: true,
    data: {
      tenants: { total: tenants.length, ...statusCounts, withPaymentMethod: withCard },
      users: {
        total: userCounts.reduce((a, u) => a + u.n, 0),
        active: userCounts.find(u => u._id === true)?.n || 0
      },
      dids: { billable: totalBillableDids },
      revenue: {
        projectedMrr: +projectedMrr.toFixed(2),
        collectedThisMonth: +(monthAgg[0]?.amount || 0).toFixed(2),
        paidInvoicesThisMonth: monthAgg[0]?.n || 0,
        collectedAllTime: invByStatus.paid?.amount || 0,
        outstanding: +((invByStatus.pending?.amount || 0) + (invByStatus.failed?.amount || 0)).toFixed(2)
      },
      invoices: invByStatus,
      credit: { totalHeldUsd: +(totalCreditCents / 100).toFixed(2) },
      recentSignups: recentTenants.map(t => ({
        tenantId: t._id, name: t.name, status: t.subscription?.status, createdAt: t.createdAt
      }))
    }
  });
}));

// =====================================================
// INVOICES (cross-tenant)
// =====================================================

// @desc    List invoices across all tenants
// @route   GET /api/v1/admin/invoices?status=&limit=
router.get('/invoices', asyncHandler(async (req, res) => {
  const { status } = req.query;
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const query = {};
  if (status && ['draft', 'pending', 'paid', 'failed', 'refunded', 'cancelled'].includes(status)) {
    query.status = status;
  }

  const invoices = await Invoice.find(query)
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('tenantId', 'name')
    .lean();

  res.json({
    success: true,
    data: {
      invoices: invoices.map(i => ({
        id: i._id,
        invoiceNumber: i.invoiceNumber,
        tenantName: i.tenantId?.name || null,
        tenantId: i.tenantId?._id || null,
        period: i.billingPeriod,
        didCount: i.didCharges?.didCount || 0,
        total: i.amounts?.total || 0,
        creditApplied: i.amounts?.creditApplied || 0,
        status: i.status,
        retryCount: i.paymentDetails?.retryCount || 0,
        failureReason: i.paymentDetails?.failureReason || null,
        paidAt: i.paymentDetails?.paidAt || null,
        createdAt: i.createdAt
      }))
    }
  });
}));

// @desc    Manually mark an invoice paid (wire transfer, comped, etc.)
// @route   POST /api/v1/admin/invoices/:id/mark-paid
router.post('/invoices/:id/mark-paid', [
  body('notes').optional().isString().isLength({ max: 200 })
], asyncHandler(async (req, res) => {
  const invoice = await Invoice.findById(req.params.id);
  if (!invoice) throw createError.notFound('Invoice not found');
  if (invoice.status === 'paid') throw createError.badRequest('Invoice is already paid');

  invoice.status = 'paid';
  invoice.paymentDetails.provider = 'manual';
  invoice.paymentDetails.transactionId = `manual-${req.user.email}`;
  invoice.paymentDetails.paidAt = new Date();
  if (req.body.notes) invoice.metadata.notes = req.body.notes;
  await invoice.save();

  console.log(`🧾 Admin ${req.user.email}: invoice ${invoice.invoiceNumber} manually marked paid`);
  res.json({ success: true, data: { invoiceNumber: invoice.invoiceNumber, status: invoice.status } });
}));

// =====================================================
// AUDIT LOG
// =====================================================

// @desc    Recent audit log entries (filter by action / tenant)
// @route   GET /api/v1/admin/audit?action=&tenantId=&limit=
router.get('/audit', asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const query = {};
  if (req.query.action) query.action = req.query.action;
  if (req.query.tenantId) query.tenantId = req.query.tenantId;

  const logs = await AuditLog.find(query)
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('userId', 'email')
    .populate('tenantId', 'name')
    .lean();

  res.json({
    success: true,
    data: {
      logs: logs.map(l => ({
        id: l._id,
        action: l.action,
        userEmail: l.userId?.email || null,
        tenantName: l.tenantId?.name || null,
        details: l.details || {},
        ipAddress: l.ipAddress || null,
        createdAt: l.createdAt
      }))
    }
  });
}));

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

// =====================================================
// CREDIT / CRYPTO
// =====================================================

// @desc    Crypto overview: recent deposits, tenants holding credit, treasury balance
// @route   GET /api/v1/admin/crypto
router.get('/crypto', asyncHandler(async (req, res) => {
  const treasury = process.env.TRON_TREASURY_ADDRESS || '';

  const [payments, tenantsWithCredit, treasuryBalance] = await Promise.all([
    CryptoPayment.find({}).sort({ createdAt: -1 }).limit(50)
      .populate('tenantId', 'name').lean(),
    Tenant.find({ 'billing.creditBalanceCents': { $gt: 0 } },
      'name billing.creditBalanceCents billing.tron')
      .sort({ 'billing.creditBalanceCents': -1 }).lean(),
    treasury ? getUsdtBalance(treasury).catch(() => null) : Promise.resolve(null)
  ]);

  res.json({
    success: true,
    data: {
      treasury,
      treasuryBalanceUsdt: treasuryBalance,
      totalCreditsUsd: tenantsWithCredit.reduce((a, t) => a + t.billing.creditBalanceCents, 0) / 100,
      tenantsWithCredit: tenantsWithCredit.map(t => ({
        tenantId: t._id,
        name: t.name,
        balanceUsd: t.billing.creditBalanceCents / 100,
        tronAddress: t.billing.tron?.address || null
      })),
      payments: payments.map(p => ({
        id: p._id,
        tenantName: p.tenantId?.name || null,
        tronAddress: p.tronAddress,
        amountUsd: p.amountUsd,
        amountUsdt: p.amountUsdt,
        txHash: p.txHash,
        status: p.status,
        createdAt: p.createdAt,
        creditedAt: p.creditedAt
      }))
    }
  });
}));

// @desc    Sweep a tenant's USDT deposit address to the treasury (or a given address)
// @route   POST /api/v1/admin/crypto/sweep  { tenantId, destination? }
router.post('/crypto/sweep', [
  body('tenantId').isMongoId().withMessage('tenantId required'),
  body('destination').optional().isString()
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) throw createError.badRequest(errors.array()[0].msg);

  const tenant = await Tenant.findById(req.body.tenantId);
  if (!tenant) throw createError.notFound('Tenant not found');

  const result = await sweepTenantUsdt(tenant, req.body.destination || undefined);
  console.log(`🪙 Admin ${req.user.email}: swept ${result.amount.toFixed(2)} USDT for ${tenant.name} (${result.txHash})`);
  res.json({ success: true, data: result });
}));

// @desc    Manually adjust a tenant's credit balance (support refunds/corrections)
// @route   POST /api/v1/admin/tenants/:id/credit  { amountUsd (±), notes? }
router.post('/tenants/:id/credit', [
  body('amountUsd').isFloat().custom(v => v !== 0).withMessage('amountUsd must be non-zero'),
  body('notes').optional().isString().isLength({ max: 200 })
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) throw createError.badRequest(errors.array()[0].msg);

  const tenant = await Tenant.findById(req.params.id);
  if (!tenant) throw createError.notFound('Tenant not found');

  const cents = Math.round(Number(req.body.amountUsd) * 100);
  let balanceAfterCents;
  if (cents > 0) {
    balanceAfterCents = await creditTenant(tenant._id, cents, 'admin_adjust', req.user.email, req.body.notes);
  } else {
    const available = tenant.billing.creditBalanceCents || 0;
    if (available < -cents) {
      throw createError.badRequest(`Balance too low — only $${(available / 100).toFixed(2)} available to deduct`);
    }
    const { balanceAfterCents: after } = await deductCredit(
      tenant._id, -cents, 'admin_adjust', req.user.email, req.body.notes
    );
    balanceAfterCents = after;
  }

  console.log(`💵 Admin ${req.user.email}: ${tenant.name} credit ${cents > 0 ? '+' : ''}$${(cents / 100).toFixed(2)}`);
  res.json({ success: true, data: { tenantId: tenant._id, balanceUsd: balanceAfterCents / 100 } });
}));

export default router;
