import express from 'express';
import jsonwebtoken from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import Reseller from '../models/Reseller.js';
import Tenant from '../models/Tenant.js';
import User from '../models/User.js';
import DID from '../models/DID.js';
import CallRecord from '../models/CallRecord.js';
import ResellerInvoice from '../models/ResellerInvoice.js';
import VICIdialSetting from '../models/VICIdialSetting.js';
import { authenticate, requireReseller } from '../middleware/auth.js';
import { calculateResellerCharge, RESELLER_PRICING_TIERS } from '../services/billing/resellerPricing.js';

const router = express.Router();

router.use(authenticate);
router.use(requireReseller);

// GET /api/v1/reseller/me — current reseller record + branding
router.get('/me', async (req, res) => {
  try {
    const reseller = await Reseller.findById(req.resellerId).lean();
    if (!reseller) return res.status(404).json({ message: 'Reseller not found' });
    res.json({ success: true, reseller });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// GET /api/v1/reseller/branding — public-ish: branding only (used by frontend bootstrap)
router.get('/branding', async (req, res) => {
  try {
    const reseller = await Reseller.findById(req.resellerId).select('name brandingConfig').lean();
    if (!reseller) return res.status(404).json({ message: 'Reseller not found' });
    res.json({ success: true, branding: reseller.brandingConfig, name: reseller.name });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// PUT /api/v1/reseller/branding
router.put('/branding', async (req, res) => {
  try {
    const { logoUrl, primaryColor, productName, supportEmail } = req.body || {};
    const reseller = await Reseller.findById(req.resellerId);
    if (!reseller) return res.status(404).json({ message: 'Reseller not found' });
    if (logoUrl !== undefined)     reseller.brandingConfig.logoUrl = logoUrl;
    if (primaryColor !== undefined)reseller.brandingConfig.primaryColor = primaryColor;
    if (productName !== undefined) reseller.brandingConfig.productName = productName;
    if (supportEmail !== undefined)reseller.brandingConfig.supportEmail = supportEmail;
    await reseller.save();
    res.json({ success: true, branding: reseller.brandingConfig });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// GET /api/v1/reseller/tenants — list this reseller's client tenants with stats
router.get('/tenants', async (req, res) => {
  try {
    const tenants = await Tenant.find({ resellerId: req.resellerId }).lean();
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const withMetrics = await Promise.all(tenants.map(async (t) => {
      const tenantId = t._id;
      const [userCount, didStats, callsToday, callsTotal] = await Promise.all([
        User.countDocuments({ tenant: tenantId }),
        DID.aggregate([
          { $match: { tenantId } },
          { $group: {
            _id: null,
            total:    { $sum: 1 },
            active:   { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
            inactive: { $sum: { $cond: [{ $eq: ['$status', 'inactive'] }, 1, 0] } },
            negative: { $sum: { $cond: [{ $eq: ['$reputation.status', 'Negative'] }, 1, 0] } },
            avgScore: { $avg: { $ifNull: ['$reputation.score', 50] } }
          }}
        ]),
        CallRecord.countDocuments({ tenantId, callTimestamp: { $gte: last24h } }),
        CallRecord.countDocuments({ tenantId })
      ]);
      const stats = didStats[0] || { total: 0, active: 0, inactive: 0, negative: 0, avgScore: 0 };
      return {
        _id: tenantId,
        name: t.name || 'Unnamed Tenant',
        isActive: t.isActive,
        subscription: { plan: t.subscription?.plan || 'basic', status: t.subscription?.status || 'trial' },
        users: userCount,
        dids: {
          total: stats.total, active: stats.active, inactive: stats.inactive,
          negative: stats.negative, avgScore: Math.round(stats.avgScore || 0)
        },
        calls: { today: callsToday, total: callsTotal },
        createdAt: t.createdAt
      };
    }));

    withMetrics.sort((a, b) => (b.dids.total - a.dids.total) || a.name.localeCompare(b.name));
    res.json({ success: true, tenants: withMetrics });
  } catch (e) {
    console.error('Reseller list tenants error:', e);
    res.status(500).json({ message: 'Failed to load tenants' });
  }
});

// POST /api/v1/reseller/tenants — create a new client tenant scoped to this reseller
// body: { name, ownerEmail, ownerFirstName, ownerLastName, ownerPassword }
// Auto-provisions: tenant + owner user (CLIENT) + a default API key (admin perms).
router.post('/tenants', async (req, res) => {
  try {
    const { name, ownerEmail, ownerFirstName, ownerLastName, ownerPassword } = req.body || {};
    if (!name || !ownerEmail || !ownerFirstName || !ownerLastName || !ownerPassword) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const existing = await User.findOne({ email: ownerEmail.toLowerCase() });
    if (existing) return res.status(409).json({ message: 'A user with that email already exists' });

    const reseller = await Reseller.findById(req.resellerId);
    const limits = reseller?.defaultClientLimits || {};

    const tenant = await Tenant.create({
      name,
      resellerId: req.resellerId,
      isActive: true,
      subscription: { plan: 'payg', status: 'active' }
    });

    if (limits.maxDIDs)  tenant.limits.maxDIDs = limits.maxDIDs;
    if (limits.maxUsers) tenant.limits.maxUsers = limits.maxUsers;
    await tenant.save();

    const user = await User.create({
      email: ownerEmail.toLowerCase().trim(),
      password: ownerPassword,
      firstName: ownerFirstName,
      lastName: ownerLastName,
      role: 'CLIENT',
      tenant: tenant._id,
      isActive: true,
      isEmailVerified: true
    });

    // Auto-provision a default API key so the client can integrate VICIdial /
    // their dialer immediately without an extra step.
    const apiKey = await tenant.generateApiKey('Default', ['admin']);

    res.status(201).json({
      success: true,
      tenant: { _id: tenant._id, name: tenant.name, subscription: tenant.subscription },
      user:   { _id: user._id, email: user.email, role: user.role },
      apiKey  // returned in cleartext exactly once — caller should surface it to the reseller
    });
  } catch (e) {
    console.error('Reseller create tenant error:', e);
    res.status(500).json({ message: e.message });
  }
});

// GET/PUT /api/v1/reseller/tenants/:tenantId/vicidial — manage a client's
// VICIdial connection on their behalf (host + creds). One VICIdialSetting per
// tenant; PUT upserts. Resellers cannot read the password back once saved.
router.get('/tenants/:tenantId/vicidial', async (req, res) => {
  try {
    const tenant = await Tenant.findOne({ _id: req.params.tenantId, resellerId: req.resellerId });
    if (!tenant) return res.status(404).json({ message: 'Tenant not found' });
    const setting = await VICIdialSetting.findOne({ tenantId: tenant._id }).lean();
    if (!setting) return res.json({ success: true, setting: null });
    res.json({ success: true, setting: {
      tenantId: setting.tenantId,
      hostname: setting.hostname,
      username: setting.username,
      passwordSet: !!setting.password
    }});
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

router.put('/tenants/:tenantId/vicidial', async (req, res) => {
  try {
    const tenant = await Tenant.findOne({ _id: req.params.tenantId, resellerId: req.resellerId });
    if (!tenant) return res.status(404).json({ message: 'Tenant not found' });
    const { hostname, username, password } = req.body || {};
    if (!hostname || !username) return res.status(400).json({ message: 'hostname and username required' });

    const existing = await VICIdialSetting.findOne({ tenantId: tenant._id });
    if (existing) {
      existing.hostname = hostname;
      existing.username = username;
      if (password) existing.password = password;
      await existing.save();
      return res.json({ success: true, setting: {
        tenantId: existing.tenantId, hostname: existing.hostname, username: existing.username, passwordSet: !!existing.password
      }});
    }
    if (!password) return res.status(400).json({ message: 'password required for new connection' });
    const created = await VICIdialSetting.create({ tenantId: tenant._id, hostname, username, password });
    res.status(201).json({ success: true, setting: {
      tenantId: created.tenantId, hostname: created.hostname, username: created.username, passwordSet: true
    }});
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// POST /api/v1/reseller/tenants/:tenantId/api-keys — issue a new key for a client
router.post('/tenants/:tenantId/api-keys', async (req, res) => {
  try {
    const tenant = await Tenant.findOne({ _id: req.params.tenantId, resellerId: req.resellerId });
    if (!tenant) return res.status(404).json({ message: 'Tenant not found' });
    const { name = 'Reseller-issued', permissions = ['admin'] } = req.body || {};
    const apiKey = await tenant.generateApiKey(name, permissions);
    res.status(201).json({ success: true, apiKey, name });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// GET /api/v1/reseller/tenants/:tenantId — detail (403 if not theirs)
router.get('/tenants/:tenantId', async (req, res) => {
  try {
    const tenant = await Tenant.findOne({ _id: req.params.tenantId, resellerId: req.resellerId }).lean();
    if (!tenant) return res.status(404).json({ message: 'Tenant not found' });

    const tenantId = tenant._id;
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [users, didStats, reputationBreakdown, callsToday, callsThisMonth, dailyCalls, topDIDs] = await Promise.all([
      User.find({ tenant: tenantId }, 'firstName lastName email role isActive lastLogin createdAt').lean(),
      DID.aggregate([
        { $match: { tenantId } },
        { $group: {
          _id: null,
          total:    { $sum: 1 },
          active:   { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
          inactive: { $sum: { $cond: [{ $eq: ['$status', 'inactive'] }, 1, 0] } },
          avgScore: { $avg: { $ifNull: ['$reputation.score', 50] } },
          totalCalls: { $sum: { $ifNull: ['$usage.totalCalls', 0] } }
        }}
      ]),
      DID.aggregate([
        { $match: { tenantId } },
        { $group: { _id: '$reputation.status', count: { $sum: 1 } } }
      ]),
      CallRecord.countDocuments({ tenantId, callTimestamp: { $gte: last24h } }),
      CallRecord.countDocuments({ tenantId, callTimestamp: { $gte: thirtyDaysAgo } }),
      CallRecord.aggregate([
        { $match: { tenantId, callTimestamp: { $gte: thirtyDaysAgo } } },
        { $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$callTimestamp' } },
          count: { $sum: 1 },
          answered: { $sum: { $cond: [{ $eq: ['$result', 'answered'] }, 1, 0] } }
        }},
        { $sort: { _id: 1 } }
      ]),
      DID.find({ tenantId })
        .sort({ 'usage.totalCalls': -1 })
        .limit(10)
        .select('phoneNumber status reputation.score reputation.status usage.totalCalls usage.lastUsed location.state')
        .lean()
    ]);

    const stats = didStats[0] || { total: 0, active: 0, inactive: 0, avgScore: 0, totalCalls: 0 };
    const repBreakdown = {};
    reputationBreakdown.forEach(r => { repBreakdown[r._id || 'Unknown'] = r.count; });

    res.json({
      success: true,
      tenant: {
        _id: tenant._id,
        name: tenant.name,
        isActive: tenant.isActive,
        subscription: tenant.subscription,
        limits: tenant.limits,
        settings: tenant.settings,
        createdAt: tenant.createdAt,
        apiKeys: (tenant.apiKeys || []).map(k => ({
          name: k.name, lastUsed: k.lastUsed, isActive: k.isActive,
          createdAt: k.createdAt,
          keyPreview: k.key ? k.key.substring(0, 12) + '...' : null
        }))
      },
      users,
      dids: {
        total: stats.total, active: stats.active, inactive: stats.inactive,
        avgScore: Math.round(stats.avgScore || 0),
        totalCalls: stats.totalCalls, reputationBreakdown: repBreakdown
      },
      calls: { today: callsToday, thisMonth: callsThisMonth, dailyHistory: dailyCalls },
      topDIDs
    });
  } catch (e) {
    console.error('Reseller tenant detail error:', e);
    res.status(500).json({ message: 'Failed to load tenant details' });
  }
});

// PATCH /api/v1/reseller/tenants/:tenantId — update limited fields
router.patch('/tenants/:tenantId', async (req, res) => {
  try {
    const tenant = await Tenant.findOne({ _id: req.params.tenantId, resellerId: req.resellerId });
    if (!tenant) return res.status(404).json({ message: 'Tenant not found' });
    const { name, isActive, maxDIDs, maxUsers } = req.body || {};
    if (name !== undefined) tenant.name = name;
    if (isActive !== undefined) tenant.isActive = !!isActive;
    if (maxDIDs !== undefined && Number.isFinite(+maxDIDs))   tenant.limits.maxDIDs  = +maxDIDs;
    if (maxUsers !== undefined && Number.isFinite(+maxUsers)) tenant.limits.maxUsers = +maxUsers;
    await tenant.save();
    res.json({ success: true, tenant });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// POST /api/v1/reseller/impersonate/:userId — login-as for a user under this reseller
router.post('/impersonate/:userId', async (req, res) => {
  try {
    const target = await User.findById(req.params.userId).populate('tenant');
    if (!target) return res.status(404).json({ message: 'User not found' });
    if (!target.isActive) return res.status(400).json({ message: 'Target user is deactivated' });
    if (!target.tenant || String(target.tenant.resellerId || '') !== req.resellerId) {
      return res.status(403).json({ message: 'Target is not under this reseller' });
    }

    console.warn(`⚠️ Reseller ${req.user.email} impersonating ${target.email} (tenant: ${target.tenant.name})`);

    const token = jsonwebtoken.sign(
      {
        id: target._id.toString(),
        email: target.email,
        firstName: target.firstName,
        lastName: target.lastName,
        role: target.role,
        impersonated: true,
        impersonatedBy: req.user._id.toString(),
        impersonatedByRole: 'RESELLER'
      },
      process.env.JWT_SECRET || 'default-secret',
      { expiresIn: '4h' }
    );

    res.json({
      success: true,
      tokens: { accessToken: token, refreshToken: token },
      user: {
        id: target._id.toString(),
        email: target.email,
        firstName: target.firstName,
        lastName: target.lastName,
        role: target.role,
        tenant: target.tenant
      }
    });
  } catch (e) {
    console.error('Reseller impersonate error:', e);
    res.status(500).json({ message: 'Impersonation failed' });
  }
});

// GET /api/v1/reseller/billing/summary — current managed-DID count + tier breakdown
router.get('/billing/summary', async (req, res) => {
  try {
    const tenants = await Tenant.find({ resellerId: req.resellerId }, '_id name').lean();
    const tenantIds = tenants.map(t => t._id);

    const perTenant = await Promise.all(tenants.map(async (t) => {
      const count = await DID.countDocuments({ tenantId: t._id, status: 'active' });
      return { tenantId: t._id, tenantName: t.name, didCount: count };
    }));

    const totalDids = perTenant.reduce((s, x) => s + x.didCount, 0);
    const charge = calculateResellerCharge(totalDids);

    res.json({
      success: true,
      currentMonth: {
        clientCount: tenants.length,
        totalDids,
        clientBreakdown: perTenant,
        tierBreakdown: charge.breakdown,
        amount: charge.total,
        pricingTiers: RESELLER_PRICING_TIERS.map(t => ({
          upTo: t.upTo === Infinity ? null : t.upTo,
          rate: t.rate
        }))
      }
    });
  } catch (e) {
    console.error('Reseller billing summary error:', e);
    res.status(500).json({ message: e.message });
  }
});

// GET /api/v1/reseller/billing/history — past invoices
router.get('/billing/history', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 24, 100);
    const invoices = await ResellerInvoice.find({ resellerId: req.resellerId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    res.json({ success: true, invoices });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

export default router;
