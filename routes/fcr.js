// Free Caller Registry (FCR) submitter routes.
//
// Background: https://www.freecallerregistry.com is the single HTML form that
// registers business DIDs with the three US carrier reputation engines
// (First Orion, Hiya, TNS). They have no public API. Our job is to:
//   1. Store the customer's FCR business profile once.
//   2. Generate the .txt file that FCR's form accepts (one phone per line,
//      +1XXXXXXXXXX format, file ≤100KB).
//   3. Track per-DID submission status + batch history.
// The customer downloads the file, submits it on FCR, and marks the batch
// submitted/approved here. We never submit on their behalf.

import express from 'express';
import mongoose from 'mongoose';
import Tenant from '../models/Tenant.js';
import DID from '../models/DID.js';
import FCRBatch from '../models/FCRBatch.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// NOTE: do NOT use `router.use(authenticate)` here. This router is mounted at
// /api/v1, so a blanket router.use would intercept every /api/v1/* request
// (including /api/v1/auth/login) and return 401. Instead, apply `authenticate`
// per-route below.

// FCR's HTML form caps the file at 100KB. We mirror that here.
const FCR_MAX_FILE_BYTES = 100 * 1024;
// Server-side cap on how many DIDs we'll process in a single batch request.
const FCR_MAX_DIDS_PER_REQUEST = 1000;

// Normalize a phone number to FCR's required +1XXXXXXXXXX format.
// Returns null if the number doesn't look like a NANP number.
function normalizeToFcrFormat(phoneNumber) {
  if (!phoneNumber) return null;
  const digits = String(phoneNumber).replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    return '+1' + digits.substring(1);
  }
  if (digits.length === 10) {
    return '+1' + digits;
  }
  return null;
}

// Generate a human-readable batch number unique per tenant per day.
async function generateBatchNumber(tenantId) {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const dayPrefix = `FCR-${yyyy}-${mm}-${dd}`;

  const startOfDay = new Date(yyyy, today.getMonth(), today.getDate());
  const endOfDay = new Date(yyyy, today.getMonth(), today.getDate() + 1);
  const countToday = await FCRBatch.countDocuments({
    tenantId,
    generatedAt: { $gte: startOfDay, $lt: endOfDay }
  });
  const seq = String(countToday + 1).padStart(3, '0');
  return `${dayPrefix}-${seq}`;
}

function getTenantId(req) {
  return req.user?.tenant?._id || req.user?.tenant;
}

// Required fields for an FCR profile to be considered "configured"
function validateFcrProfile(profile) {
  const errors = [];
  if (!profile?.businessName?.trim()) errors.push('businessName is required');
  if (!profile?.address?.street?.trim()) errors.push('address.street is required');
  if (!profile?.address?.city?.trim()) errors.push('address.city is required');
  if (!profile?.address?.state?.trim()) errors.push('address.state is required');
  if (!profile?.address?.zip?.trim()) errors.push('address.zip is required');
  if (!profile?.contact?.name?.trim()) errors.push('contact.name is required');
  if (!profile?.contact?.phone?.trim()) errors.push('contact.phone is required');
  if (!profile?.contact?.email?.trim()) errors.push('contact.email is required');
  if (!profile?.callPurpose?.trim()) errors.push('callPurpose is required');
  return errors;
}

// GET /api/v1/settings/fcr-profile — return tenant's FCR profile (or null)
router.get('/settings/fcr-profile', authenticate, async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant required' });

    const tenant = await Tenant.findById(tenantId).select('fcrProfile').lean();
    if (!tenant) return res.status(404).json({ success: false, error: 'Tenant not found' });

    const profile = tenant.fcrProfile && tenant.fcrProfile.businessName ? tenant.fcrProfile : null;
    res.json({ success: true, data: profile });
  } catch (err) {
    console.error('FCR profile get error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/v1/settings/fcr-profile — create or update the profile
router.put('/settings/fcr-profile', authenticate, async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant required' });

    const body = req.body || {};
    const errors = validateFcrProfile(body);
    if (errors.length > 0) {
      return res.status(400).json({ success: false, error: 'Validation failed', details: errors });
    }

    const tenant = await Tenant.findById(tenantId);
    if (!tenant) return res.status(404).json({ success: false, error: 'Tenant not found' });

    const now = new Date();
    const wasConfigured = !!tenant.fcrProfile?.configuredAt;
    tenant.fcrProfile = {
      businessName: body.businessName.trim(),
      address: {
        street: body.address.street.trim(),
        city: body.address.city.trim(),
        state: body.address.state.trim(),
        zip: body.address.zip.trim()
      },
      website: body.website?.trim() || '',
      contact: {
        name: body.contact.name.trim(),
        phone: body.contact.phone.trim(),
        email: body.contact.email.trim()
      },
      callPurpose: body.callPurpose.trim(),
      monthlyCallVolume: Number(body.monthlyCallVolume) || 0,
      configuredAt: wasConfigured ? tenant.fcrProfile.configuredAt : now,
      updatedAt: now
    };
    await tenant.save();

    res.json({ success: true, data: tenant.fcrProfile });
  } catch (err) {
    console.error('FCR profile put error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/v1/dids/fcr/generate-batch
// Body: { didIds: [ObjectId] }
// Generates the .txt file content, creates an FCRBatch record, updates DIDs.
router.post('/dids/fcr/generate-batch', authenticate, async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant required' });

    const { didIds } = req.body || {};
    if (!Array.isArray(didIds) || didIds.length === 0) {
      return res.status(400).json({ success: false, error: 'didIds array required' });
    }
    if (didIds.length > FCR_MAX_DIDS_PER_REQUEST) {
      return res.status(400).json({
        success: false,
        error: `Too many DIDs in one batch (max ${FCR_MAX_DIDS_PER_REQUEST})`,
        requested: didIds.length
      });
    }

    // Profile must be configured before generating a batch — the customer
    // needs the profile fields to paste into FCR alongside the file.
    const tenant = await Tenant.findById(tenantId).select('fcrProfile').lean();
    if (!tenant?.fcrProfile?.businessName) {
      return res.status(400).json({
        success: false,
        error: 'FCR profile not configured. Configure it in Settings → Carrier Registration first.'
      });
    }

    // Load DIDs scoped to this tenant. Anything not in this tenant is
    // silently dropped (don't leak existence of other tenants' DIDs).
    const validObjectIds = didIds
      .filter(id => mongoose.Types.ObjectId.isValid(id))
      .map(id => new mongoose.Types.ObjectId(id));

    const dids = await DID.find({
      _id: { $in: validObjectIds },
      tenantId
    }).select('_id phoneNumber fcrStatus').lean();

    if (dids.length === 0) {
      return res.status(400).json({ success: false, error: 'No matching DIDs found for this tenant' });
    }

    // Find DIDs already locked into an open batch (status generated or
    // submitted, not yet resolved). Skip those — re-submitting the same
    // number while a prior submission is in-flight just confuses FCR.
    const openBatches = await FCRBatch.find({
      tenantId,
      status: { $in: ['generated', 'submitted'] }
    }).select('didIds').lean();
    const lockedDidIds = new Set();
    for (const b of openBatches) {
      for (const id of b.didIds) lockedDidIds.add(String(id));
    }

    // Build the file content. Dedupe + normalize.
    const seen = new Set();
    const includedDidIds = [];
    const includedPhones = [];
    const skipped = { invalid: 0, duplicate: 0, locked: 0, oversize: 0 };

    for (const did of dids) {
      if (lockedDidIds.has(String(did._id))) {
        skipped.locked++;
        continue;
      }
      const normalized = normalizeToFcrFormat(did.phoneNumber);
      if (!normalized) {
        skipped.invalid++;
        continue;
      }
      if (seen.has(normalized)) {
        skipped.duplicate++;
        continue;
      }

      // Probe: would adding this line exceed 100KB? If yes, stop here.
      // Each line is normalized + "\n" — measure in bytes (NANP numbers
      // are ASCII so .length == byte length).
      const lineBytes = Buffer.byteLength(normalized + '\n', 'utf8');
      const currentBytes = includedPhones.reduce(
        (acc, p) => acc + Buffer.byteLength(p + '\n', 'utf8'),
        0
      );
      if (currentBytes + lineBytes > FCR_MAX_FILE_BYTES) {
        skipped.oversize = dids.length - dids.indexOf(did);
        break;
      }

      seen.add(normalized);
      includedDidIds.push(did._id);
      includedPhones.push(normalized);
    }

    if (includedPhones.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No eligible DIDs to include in batch',
        skipped
      });
    }

    const fileContent = includedPhones.join('\n') + '\n';
    const fileSize = Buffer.byteLength(fileContent, 'utf8');
    const batchNumber = await generateBatchNumber(tenantId);
    const fileName = `${batchNumber}.txt`;

    const batch = await FCRBatch.create({
      tenantId,
      batchNumber,
      didIds: includedDidIds,
      phoneNumbers: includedPhones,
      fileFormat: 'txt',
      fileSize,
      status: 'generated',
      createdBy: req.user?._id,
      generatedAt: new Date()
    });

    // Tag the DIDs with this batch so they show up as "submitted-pending"
    // until the customer comes back and marks the batch as actually
    // submitted on FCR's website.
    await DID.updateMany(
      { _id: { $in: includedDidIds }, tenantId },
      { $set: { fcrBatchId: batch._id } }
    );

    res.json({
      success: true,
      batchId: batch._id,
      batchNumber,
      fileName,
      fileContent,
      fileSize,
      phoneCount: includedPhones.length,
      requested: didIds.length,
      skipped
    });
  } catch (err) {
    console.error('FCR generate-batch error:', err.message, err.stack);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/v1/dids/fcr/batches — list batches (paginated)
router.get('/dids/fcr/batches', authenticate, async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant required' });

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 25));
    const skip = (page - 1) * limit;

    const [batches, total] = await Promise.all([
      FCRBatch.find({ tenantId })
        .sort({ generatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .select('-phoneNumbers') // omit the snapshot in the list view
        .lean(),
      FCRBatch.countDocuments({ tenantId })
    ]);

    res.json({
      success: true,
      data: batches,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) }
    });
  } catch (err) {
    console.error('FCR list batches error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/v1/dids/fcr/batch/:id/file — re-download the .txt file
router.get('/dids/fcr/batch/:id/file', authenticate, async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant required' });

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, error: 'Invalid batch ID' });
    }
    const batch = await FCRBatch.findOne({
      _id: req.params.id,
      tenantId
    }).lean();
    if (!batch) return res.status(404).json({ success: false, error: 'Batch not found' });

    const fileContent = (batch.phoneNumbers || []).join('\n') + '\n';
    res.set('Content-Type', 'text/plain');
    res.set('Content-Disposition', `attachment; filename="${batch.batchNumber}.txt"`);
    res.send(fileContent);
  } catch (err) {
    console.error('FCR batch file error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/v1/dids/fcr/batch/:id/mark-submitted — flip status, stamp DIDs
router.post('/dids/fcr/batch/:id/mark-submitted', authenticate, async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant required' });

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, error: 'Invalid batch ID' });
    }
    const batch = await FCRBatch.findOne({ _id: req.params.id, tenantId });
    if (!batch) return res.status(404).json({ success: false, error: 'Batch not found' });

    const now = new Date();
    batch.status = 'submitted';
    batch.submittedAt = now;
    if (req.body?.notes) batch.notes = String(req.body.notes).substring(0, 2000);
    await batch.save();

    await DID.updateMany(
      { _id: { $in: batch.didIds }, tenantId },
      { $set: { fcrStatus: 'submitted', fcrSubmittedAt: now, fcrBatchId: batch._id } }
    );

    res.json({ success: true, data: batch });
  } catch (err) {
    console.error('FCR mark-submitted error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/v1/dids/fcr/batch/:id/mark-approved — final state after FCR confirms
router.post('/dids/fcr/batch/:id/mark-approved', authenticate, async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(403).json({ success: false, error: 'Tenant required' });

    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, error: 'Invalid batch ID' });
    }
    const batch = await FCRBatch.findOne({ _id: req.params.id, tenantId });
    if (!batch) return res.status(404).json({ success: false, error: 'Batch not found' });

    const now = new Date();
    batch.status = 'approved';
    batch.approvedAt = now;
    if (req.body?.notes) batch.notes = String(req.body.notes).substring(0, 2000);
    await batch.save();

    await DID.updateMany(
      { _id: { $in: batch.didIds }, tenantId },
      { $set: { fcrStatus: 'approved', fcrApprovedAt: now } }
    );

    res.json({ success: true, data: batch });
  } catch (err) {
    console.error('FCR mark-approved error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Export helpers for unit tests
export const __test__ = {
  normalizeToFcrFormat,
  FCR_MAX_FILE_BYTES,
  FCR_MAX_DIDS_PER_REQUEST
};

export default router;
