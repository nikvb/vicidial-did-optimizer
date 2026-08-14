import mongoose from 'mongoose';
import express from 'express';
import { body, validationResult } from 'express-validator';
import multer from 'multer';
import fs from 'fs';
import csv from 'csv-parser';
import DID from '../../models/DID.js';
import AreaCodeLocation from '../../models/AreaCodeLocation.js';
import CampaignDIDPool from '../../models/CampaignDIDPool.js';
import { asyncHandler, createError } from '../middleware/errorHandler.js';
import { authenticate, validateApiKey } from '../../middleware/auth.js';
import { enqueueReputationCheck } from '../../services/reputation-queue.js';

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  dest: 'uploads/',
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.csv', '.json'];
    const ext = file.originalname.toLowerCase().substring(file.originalname.lastIndexOf('.'));
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV and JSON files are allowed'), false);
    }
  }
});

// @desc    Get all DIDs for authenticated user with pagination and sorting
// @route   GET /api/v1/dids
// @access  Private
router.get('/', authenticate, asyncHandler(async (req, res) => {
  // Parse query parameters
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 25;
  const sortBy = req.query.sortBy || 'createdAt';
  const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
  const search = req.query.search || '';

  // Build query
  const query = { tenantId: req.user.tenant._id };

  // Add search filter if provided
  if (search) {
    query.$or = [
      { phoneNumber: { $regex: search, $options: 'i' } },
      { 'metadata.carrier': { $regex: search, $options: 'i' } },
      { 'location.state': { $regex: search, $options: 'i' } },
      { 'location.city': { $regex: search, $options: 'i' } }
    ];
  }

  // Calculate pagination
  const skip = (page - 1) * limit;

  // Build sort object
  const sort = {};
  sort[sortBy] = sortOrder;

  // Execute query with pagination
  const [dids, total] = await Promise.all([
    DID.find(query)
      .sort(sort)
      .skip(skip)
      .limit(limit),
    DID.countDocuments(query)
  ]);

  // Enrich DIDs with NPANXX location data — single batch query
  const didObjects = dids.map(d => d.toObject());

  const areaCodeSet = new Set();
  for (const didObj of didObjects) {
    const clean = (didObj.phoneNumber || '').replace(/\D/g, '');
    if (clean.length === 11 && clean.startsWith('1')) areaCodeSet.add(clean.substring(1, 4));
    else if (clean.length === 10) areaCodeSet.add(clean.substring(0, 3));
  }

  const locationRows = areaCodeSet.size > 0
    ? await AreaCodeLocation.find({ areaCode: { $in: [...areaCodeSet] } }).lean()
    : [];
  const locationMap = new Map(locationRows.map(l => [l.areaCode, l]));

  const enrichedDIDs = didObjects.map(didObj => {
    const clean = (didObj.phoneNumber || '').replace(/\D/g, '');
    let areaCode = null;
    if (clean.length === 11 && clean.startsWith('1')) areaCode = clean.substring(1, 4);
    else if (clean.length === 10) areaCode = clean.substring(0, 3);

    const loc = areaCode ? locationMap.get(areaCode) : null;
    if (loc) {
      didObj.npanxxLocation = {
        areaCode: loc.areaCode,
        city: loc.city,
        state: loc.state,
        country: loc.country,
        coordinates: loc.location.coordinates
      };
    }
    return didObj;
  });

  // Calculate pagination info
  const totalPages = Math.ceil(total / limit);
  const hasNext = page < totalPages;
  const hasPrev = page > 1;

  res.json({
    success: true,
    data: enrichedDIDs,
    pagination: {
      current: page,
      pages: totalPages,
      total: total,
      limit: limit,
      hasNext: hasNext,
      hasPrev: hasPrev
    },
    filters: {
      search: search,
      sortBy: sortBy,
      sortOrder: req.query.sortOrder || 'desc'
    }
  });
}));

// @desc    Get DID statistics
// @route   GET /api/v1/dids/stats
// @access  Private
router.get('/stats', authenticate, asyncHandler(async (req, res) => {
  const tenantId = req.user.tenant._id;

  const [agg] = await DID.aggregate([
    { $match: { tenantId } },
    { $group: {
      _id: null,
      total: { $sum: 1 },
      active: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
      totalScore: { $sum: { $ifNull: ['$reputation.score', 50] } },
      issues: { $sum: { $cond: [
        { $or: [
          { $lt: [{ $ifNull: ['$reputation.score', 50] }, 50] },
          { $eq: ['$status', 'inactive'] }
        ]}, 1, 0
      ]}}
    }}
  ]);

  const total = agg?.total || 0;
  const active = agg?.active || 0;
  const issues = agg?.issues || 0;
  const avgScore = total > 0 ? Math.round((agg?.totalScore || 0) / total) : 0;

  res.json({
    success: true,
    data: {
      total,
      active,
      avgScore,
      issues
    }
  });
}));

// @desc    Get all DID IDs for bulk selection
// @route   GET /api/v1/dids/all-ids
// @access  Private
router.get('/all-ids', authenticate, asyncHandler(async (req, res) => {
  const search = req.query.search || '';
  const tenantId = req.user.tenant._id;

  // Build search query if search term provided
  let searchQuery = { tenantId };
  if (search.trim()) {
    const searchRegex = new RegExp(search.trim(), 'i');
    searchQuery.$or = [
      { phoneNumber: searchRegex },
      { 'usage.lastCampaign': searchRegex },
      { 'location.city': searchRegex },
      { 'location.state': searchRegex },
    ];
  }

  // Get all DID IDs matching the search criteria
  const dids = await DID.find(searchQuery).select('_id').lean();
  const ids = dids.map(did => did._id.toString());

  res.json({
    success: true,
    ids: ids,
    count: ids.length
  });
}));

// @desc    Export DIDs to CSV
// @route   GET /api/v1/dids/export
// @access  Private
// NOTE: This route MUST be before /:id route to avoid "export" being treated as an ID
router.get('/export', authenticate, asyncHandler(async (req, res) => {
  console.log('📥 Export DIDs request from tenant:', req.user.tenant._id);

  const dids = await DID.find({ tenantId: req.user.tenant._id }).sort({ phoneNumber: 1 });

  // Generate CSV
  let csv = 'Phone Number,Status,Location (City),Location (State),Area Code,Total Calls,Last Used,Last Campaign,Reputation Score\n';

  dids.forEach(did => {
    const phoneNumber = did.phoneNumber || did.number || '';
    const status = did.status || '';
    const city = did.location?.city || '';
    const state = did.location?.state || '';
    const areaCode = did.location?.areaCode || '';
    const totalCalls = did.usage?.totalCalls || did.calls || 0;
    const lastUsed = did.usage?.lastUsed ? new Date(did.usage.lastUsed).toISOString() : '';
    const lastCampaign = did.usage?.lastCampaign || '';
    const reputationScore = did.reputation?.score || 0;

    csv += `"${phoneNumber}","${status}","${city}","${state}","${areaCode}",${totalCalls},"${lastUsed}","${lastCampaign}",${reputationScore}\n`;
  });

  // Set headers for file download
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=dids_export_${new Date().toISOString().split('T')[0]}.csv`);
  res.send(csv);

  console.log('✅ Exported', dids.length, 'DIDs to CSV');
}));

// @desc    Get single DID
// @route   GET /api/v1/dids/:id
// @access  Private
router.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const did = await DID.findOne({
    _id: req.params.id,
    tenantId: req.user.tenant._id
  });

  if (!did) {
    throw createError.notFound('DID not found');
  }

  res.json({
    success: true,
    data: did
  });
}));

// @desc    Create new DID
// @route   POST /api/v1/dids
// @access  Private
router.post('/', authenticate, [
  body('phoneNumber')
    .notEmpty()
    .withMessage('Phone number is required')
    .matches(/^\+?[\d\s\-()]+$/)
    .withMessage('Phone number must be valid'),
  body('status')
    .optional()
    .isIn(['active', 'inactive'])
    .withMessage('Status must be active or inactive'),
  body('capacity')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Capacity must be a positive integer')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw createError.badRequest(errors.array()[0].msg);
  }

  const { phoneNumber, status = 'active', capacity = 1 } = req.body;

  // Check if DID already exists for this tenant
  const existingDid = await DID.findOne({
    phoneNumber,
    tenantId: req.user.tenant._id
  });

  if (existingDid) {
    throw createError.conflict('DID already exists for this tenant');
  }

  const did = await DID.create({
    phoneNumber,
    status,
    capacity,
    tenantId: req.user.tenant._id,
    createdBy: req.user._id
  });

  res.status(201).json({
    success: true,
    data: did
  });
}));

// @desc    Bulk upload DIDs
// @route   POST /api/v1/dids/bulk
// @access  Private
router.post('/bulk', authenticate, upload.single('file'), asyncHandler(async (req, res) => {
  console.log('🚀 Bulk upload started');
  console.log('📁 File received:', req.file);
  
  if (!req.file) {
    throw createError.badRequest('No file uploaded');
  }

  const { path: filePath, originalname } = req.file;
  const tenantId = req.user.tenant._id;
  const userId = req.user._id;
  
  console.log('📋 Upload details:', { filePath, originalname, tenantId: tenantId.toString(), userId: userId.toString() });
  
  let didsData = [];
  const results = {
    created: 0,
    skipped: 0,
    errors: []
  };
  const createdPhones = [];

  try {
    const ext = originalname.toLowerCase().substring(originalname.lastIndexOf('.'));
    
    if (ext === '.json') {
      // Handle JSON file
      const fileContent = fs.readFileSync(filePath, 'utf8');
      const jsonData = JSON.parse(fileContent);
      
      if (!Array.isArray(jsonData)) {
        throw createError.badRequest('JSON file must contain an array of DID objects');
      }
      
      didsData = jsonData;
    } else if (ext === '.csv') {
      // Handle CSV file
      console.log('📄 Processing CSV file...');
      await new Promise((resolve, reject) => {
        fs.createReadStream(filePath)
          .pipe(csv())
          .on('data', (row) => {
            console.log('📝 CSV row:', row);
            didsData.push(row);
          })
          .on('end', () => {
            console.log('✅ CSV processing complete. Total rows:', didsData.length);
            resolve();
          })
          .on('error', (err) => {
            console.error('❌ CSV processing error:', err);
            reject(err);
          });
      });
    }

    // Process each DID
    for (let i = 0; i < didsData.length; i++) {
      const didData = didsData[i];
      console.log(`🔍 Processing row ${i + 1}:`, didData);
      
      try {
        // Extract phone number from various possible field names
        let phoneNumber = didData.phoneNumber || didData.PhoneNumber || didData.phone_number;
        
        // If still no phone number found, try to find it by looking for phone-like values
        if (!phoneNumber) {
          const keys = Object.keys(didData);
          for (const key of keys) {
            const value = didData[key];
            if (typeof value === 'string' && /^\+?[\d\s\-()]+$/.test(value) && value.length >= 10) {
              phoneNumber = value;
              console.log(`📞 Found phone number in field "${key}": ${phoneNumber}`);
              break;
            }
          }
        }
        
        // Validate phone number exists
        if (!phoneNumber) {
          console.log(`❌ Row ${i + 1}: No phone number found in:`, Object.keys(didData));
          results.errors.push(`Row ${i + 1}: Phone number is required`);
          results.skipped++;
          continue;
        }

        // Validate phone number format
        if (!/^\+?[\d\s\-()]+$/.test(phoneNumber)) {
          results.errors.push(`Row ${i + 1}: Invalid phone number format: ${phoneNumber}`);
          results.skipped++;
          continue;
        }

        // Extract status
        let status = didData.status || didData.Status || 'active';
        if (status && typeof status === 'string') {
          status = status.toLowerCase();
          // Handle common misspellings
          if (status.includes('activ')) status = 'active';
          if (status.includes('inactiv')) status = 'inactive';
        }
        if (!['active', 'inactive'].includes(status)) {
          status = 'active';
        }

        // Extract capacity
        let capacity = didData.capacity || didData.Capacity || 1;
        if (typeof capacity === 'string') {
          capacity = parseInt(capacity) || 1;
        }

        console.log(`✅ Processed data - Phone: ${phoneNumber}, Status: ${status}, Capacity: ${capacity}`);

        // Check if DID already exists for this tenant
        const existingDid = await DID.findOne({
          phoneNumber: phoneNumber,
          tenantId: tenantId
        });

        if (existingDid) {
          results.errors.push(`Row ${i + 1}: DID ${phoneNumber} already exists`);
          results.skipped++;
          continue;
        }

        // Create DID
        await DID.create({
          phoneNumber: phoneNumber,
          status: status,
          capacity: capacity,
          tenantId: tenantId,
          createdBy: userId
        });

        console.log(`🎉 Created DID: ${phoneNumber}`);
        createdPhones.push(phoneNumber.replace(/\D/g, '').replace(/^1(\d{10})$/, '$1'));
        results.created++;
      } catch (error) {
        console.error(`❌ Error processing row ${i + 1}:`, error);
        results.errors.push(`Row ${i + 1}: ${error.message}`);
        results.skipped++;
      }
    }

    console.log('🎉 Bulk upload completed:', results);

    // Immediately enqueue new DIDs for reputation check (high priority)
    if (createdPhones.length > 0) {
      enqueueReputationCheck(createdPhones, 'high').catch(err =>
        console.error('Failed to enqueue reputation check:', err.message)
      );
    }

    res.json({
      success: true,
      message: `Bulk upload completed. Created: ${results.created}, Skipped: ${results.skipped}`,
      data: results
    });

  } catch (error) {
    throw createError.badRequest(`Failed to process file: ${error.message}`);
  } finally {
    // Clean up uploaded file
    try {
      fs.unlinkSync(filePath);
    } catch (cleanupError) {
      console.error('Failed to cleanup uploaded file:', cleanupError);
    }
  }
}));

// @desc    Update DID
// @route   PUT /api/v1/dids/:id
// @access  Private
router.put('/:id', authenticate, [
  body('phoneNumber')
    .optional()
    .matches(/^\+?[\d\s\-()]+$/)
    .withMessage('Phone number must be valid'),
  body('status')
    .optional()
    .isIn(['active', 'inactive'])
    .withMessage('Status must be active or inactive'),
  body('capacity')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Capacity must be a positive integer')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw createError.badRequest(errors.array()[0].msg);
  }

  const did = await DID.findOne({
    _id: req.params.id,
    tenantId: req.user.tenant._id
  });

  if (!did) {
    throw createError.notFound('DID not found');
  }

  // Update fields
  Object.keys(req.body).forEach(key => {
    if (['phoneNumber', 'status', 'capacity'].includes(key)) {
      did[key] = req.body[key];
    }
  });

  did.updatedBy = req.user._id;
  await did.save();

  res.json({
    success: true,
    data: did
  });
}));

// @desc    Delete DID
// @route   DELETE /api/v1/dids/:id
// @access  Private
router.delete('/:id', authenticate, asyncHandler(async (req, res) => {
  const did = await DID.findOne({
    _id: req.params.id,
    tenantId: req.user.tenant._id
  });

  if (!did) {
    throw createError.notFound('DID not found');
  }

  await did.deleteOne();

  res.json({
    success: true,
    message: 'DID deleted successfully'
  });
}));

// @desc    Bulk actions on DIDs
// @route   POST /api/v1/dids/bulk-action
// @access  Private
router.post('/bulk-action', authenticate, [
  body('action')
    .notEmpty()
    .isIn(['delete', 'activate', 'deactivate', 'update-status', 'recheck'])
    .withMessage('Action must be one of: delete, activate, deactivate, update-status, recheck'),
  body('didIds')
    .isArray({ min: 1 })
    .withMessage('didIds must be a non-empty array'),
  body('didIds.*')
    .isMongoId()
    .withMessage('Each DID ID must be a valid MongoDB ObjectId')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw createError.badRequest(errors.array()[0].msg);
  }

  const { action, didIds, newStatus } = req.body;
  const tenantId = req.user.tenant._id;

  // Verify all DIDs belong to this tenant
  const dids = await DID.find({
    _id: { $in: didIds },
    tenantId: tenantId
  });

  if (dids.length !== didIds.length) {
    throw createError.badRequest('Some DIDs not found or do not belong to your tenant');
  }

  let result = { success: true, processed: 0, errors: [] };

  switch (action) {
    case 'delete':
      const deleteResult = await DID.deleteMany({
        _id: { $in: didIds },
        tenantId: tenantId
      });
      result.processed = deleteResult.deletedCount;
      result.message = `Deleted ${deleteResult.deletedCount} DIDs`;
      break;

    case 'activate':
      const activateResult = await DID.updateMany(
        { _id: { $in: didIds }, tenantId: tenantId },
        {
          $set: {
            status: 'active',
            updatedBy: req.user._id,
            updatedAt: new Date()
          }
        }
      );
      result.processed = activateResult.modifiedCount;
      result.message = `Activated ${activateResult.modifiedCount} DIDs`;
      break;

    case 'deactivate':
      const deactivateResult = await DID.updateMany(
        { _id: { $in: didIds }, tenantId: tenantId },
        {
          $set: {
            status: 'inactive',
            updatedBy: req.user._id,
            updatedAt: new Date()
          }
        }
      );
      result.processed = deactivateResult.modifiedCount;
      result.message = `Deactivated ${deactivateResult.modifiedCount} DIDs`;
      break;

    case 'update-status':
      if (!newStatus || !['active', 'inactive'].includes(newStatus)) {
        throw createError.badRequest('newStatus is required and must be active or inactive');
      }
      const updateResult = await DID.updateMany(
        { _id: { $in: didIds }, tenantId: tenantId },
        {
          $set: {
            status: newStatus,
            updatedBy: req.user._id,
            updatedAt: new Date()
          }
        }
      );
      result.processed = updateResult.modifiedCount;
      result.message = `Updated ${updateResult.modifiedCount} DIDs to ${newStatus}`;
      break;

    case 'recheck':
      const phoneNumbers = dids.map(did => {
        const cleaned = (did.phoneNumber || '').replace(/\D/g, '');
        return cleaned.startsWith('1') && cleaned.length === 11 ? cleaned.slice(1) : cleaned;
      }).filter(Boolean);
      await enqueueReputationCheck(phoneNumbers, 'high');
      result.processed = phoneNumbers.length;
      result.message = `Queued ${phoneNumbers.length} DIDs for reputation recheck`;
      break;

    default:
      throw createError.badRequest('Invalid action');
  }

  res.json(result);
}));

// @desc    Trigger reputation recheck for a single DID
// @route   POST /api/v1/dids/:id/recheck
// @access  Private
router.post('/:id/recheck', authenticate, asyncHandler(async (req, res) => {
  const did = await DID.findOne({
    _id: req.params.id,
    tenantId: req.user.tenant._id
  });

  if (!did) {
    throw createError.notFound('DID not found');
  }

  const cleaned = (did.phoneNumber || '').replace(/\D/g, '');
  const phone = cleaned.startsWith('1') && cleaned.length === 11 ? cleaned.slice(1) : cleaned;

  await enqueueReputationCheck([phone], 'high');

  res.json({
    success: true,
    message: `Queued ${did.phoneNumber} for reputation recheck`,
    phoneNumber: did.phoneNumber
  });
}));

// @desc    Get next available DID for VICIdial (API key auth)
// @route   GET /api/v1/dids/next
// @access  API Key Authentication
router.get('/next', validateApiKey, asyncHandler(async (req, res) => {
  console.log('🎯 DID Next endpoint called');
  console.log('📊 Query params:', req.query);
  console.log('🏢 Tenant:', req.tenant?.name, 'ID:', req.tenant?._id);

  // Get query parameters from VICIdial
  const {
    campaign_id,
    agent_id,
    caller_id,
    customer_state,
    customer_area_code,
    customer_phone
  } = req.query;

  let selectedDID = null;
  let selectionSource = 'tenant_pool';
  let poolId = null;
  let campaignPool = null;

  // Try to find campaign-specific DID pool first
  if (campaign_id) {
    console.log('🔍 Looking for campaign DID pool:', campaign_id);
    
    const pool = await CampaignDIDPool.findByCampaign(req.tenant._id, campaign_id);
    
    if (pool && pool.status.type === 'active') {
      console.log('✅ Found campaign DID pool:', pool.campaignName);
      
      // Get next DID from campaign pool
      const customerInfo = {
        customerState,
        customerAreaCode: customer_area_code,
        customerPhone: customer_phone
      };
      
      selectedDID = await pool.getNextDID(customerInfo);

      if (selectedDID) {
        selectionSource = 'campaign_pool';
        poolId = pool._id;
        campaignPool = pool;
        console.log('🎯 Selected DID from campaign pool:', selectedDID.phoneNumber);
      } else if (pool.fallback.enabled) {
        console.log('⚠️ Campaign pool exhausted, checking fallback');
        campaignPool = pool;
        poolId = pool._id;

        if (pool.fallback.fallbackToTenantPool) {
          selectionSource = 'tenant_pool_fallback';
          console.log('🔄 Falling back to tenant pool');
        } else if (pool.fallback.fallbackDid) {
          selectionSource = 'campaign_fallback_did';
          selectedDID = {
            phoneNumber: pool.fallback.fallbackDid,
            isFallback: true
          };
          console.log('🔄 Using campaign fallback DID:', selectedDID.phoneNumber);
        }
      }
    }
  }

  // If no DID selected from campaign pool, use tenant pool
  if (!selectedDID) {
    console.log('🔍 Looking for DID in tenant pool');
    
    // Build query for tenant pool
    const query = {
      tenantId: req.tenant._id,
      status: 'active',
      isActive: true
    };
    
    // Filter by reputation score
    query['reputation.score'] = { $gte: 50 };
    
    // Find available DID
    selectedDID = await DID.findOne(query)
      .sort({ 'usage.lastUsed': 1 })
      .limit(1);
    
    if (selectedDID) {
      console.log('✅ Selected DID from tenant pool:', selectedDID.phoneNumber);
    }
  }

  // If still no DID available, use global fallback
  if (!selectedDID) {
    console.log('⚠️ No DIDs available, using global fallback');
    return res.json({
      success: true,
      did: {
        number: process.env.FALLBACK_DID || '+18005551234',
        is_fallback: true,
        source: 'global_fallback'
      },
      metadata: {
        campaign_id,
        agent_id,
        timestamp: new Date().toISOString(),
        message: 'All DIDs exhausted, using fallback'
      }
    });
  }

  // Update DID usage
  if (!selectedDID.isFallback) {
    selectedDID.usage.totalCalls = (selectedDID.usage.totalCalls || 0) + 1;
    selectedDID.usage.lastUsed = new Date();
    selectedDID.usage.lastCampaign = campaign_id;
    selectedDID.usage.lastAgent = agent_id;
    selectedDID.lastCampaignUsed = {
      campaignId: campaign_id,
      poolId,
      usedAt: new Date()
    };
    
    // Increment today's usage
    selectedDID.incrementTodayUsage();
    
    await selectedDID.save();
  }

  // Record selection in pool if applicable
  if (campaignPool && (selectionSource === 'campaign_pool' || selectionSource === 'tenant_pool_fallback')) {
    const result = selectionSource === 'campaign_pool' ? 'success' : 'fallback';
    await campaignPool.recordSelection(selectedDID, result, campaign_id, agent_id);
  }

  // Return the DID in VICIdial format
  res.json({
    success: true,
    did: {
      number: selectedDID.phoneNumber,
      description: selectedDID.description,
      carrier: selectedDID.metadata?.carrier,
      location: selectedDID.location,
      is_fallback: selectedDID.isFallback || false
    },
    metadata: {
      campaign_id,
      agent_id,
      timestamp: new Date().toISOString(),
      source: selectionSource,
      pool_id: poolId ? poolId.toString() : null
    }
  });
}));

export default router;