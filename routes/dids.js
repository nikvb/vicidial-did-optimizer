import mongoose from 'mongoose';
import express from 'express';
import { body, validationResult } from 'express-validator';
import multer from 'multer';
import fs from 'fs';
import csv from 'csv-parser';
// Import DID model from shared models directory
import DID from '../../models/DID.js';
import AreaCodeLocation from '../../models/AreaCodeLocation.js';
import { asyncHandler, createError } from '../middleware/errorHandler.js';
import { authenticate, validateApiKey } from '../../middleware/auth.js';

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

  // Enrich DIDs with NPANXX location data
  const enrichedDIDs = await Promise.all(dids.map(async (did) => {
    const didObj = did.toObject();

    // Extract area code from phone number (first 3 digits after country code)
    const phoneNumber = didObj.phoneNumber;
    let areaCode = null;

    if (phoneNumber) {
      // Handle different phone number formats (+1XXXXXXXXXX, 1XXXXXXXXXX, XXXXXXXXXX)
      const cleanNumber = phoneNumber.replace(/\D/g, '');
      if (cleanNumber.length >= 10) {
        if (cleanNumber.startsWith('1') && cleanNumber.length === 11) {
          areaCode = cleanNumber.substring(1, 4);
        } else if (cleanNumber.length === 10) {
          areaCode = cleanNumber.substring(0, 3);
        }
      }
    }

    // Lookup location data from NPANXX database
    if (areaCode) {
      try {
        const locationData = await AreaCodeLocation.findOne({ areaCode });
        if (locationData) {
          didObj.npanxxLocation = {
            areaCode: locationData.areaCode,
            city: locationData.city,
            state: locationData.state,
            country: locationData.country,
            coordinates: locationData.location.coordinates
          };
        }
      } catch (error) {
        console.warn(`Failed to lookup location for area code ${areaCode}:`, error.message);
      }
    }

    return didObj;
  }));

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

  // Get total count
  const total = await DID.countDocuments({ tenantId });

  // Get active count
  const active = await DID.countDocuments({ tenantId, status: 'active' });

  // Calculate average score and issues count
  const didsWithScores = await DID.find({ tenantId }, 'reputation.score status');

  let totalScore = 0;
  let issues = 0;

  didsWithScores.forEach(did => {
    const score = did.reputation?.score || 50;
    totalScore += score;

    if (score < 50 || did.status === 'inactive') {
      issues++;
    }
  });

  const avgScore = total > 0 ? Math.round(totalScore / total) : 0;

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
        results.created++;
      } catch (error) {
        console.error(`❌ Error processing row ${i + 1}:`, error);
        results.errors.push(`Row ${i + 1}: ${error.message}`);
        results.skipped++;
      }
    }

    console.log('🎉 Bulk upload completed:', results);
    
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
    .isIn(['delete', 'activate', 'deactivate', 'update-status'])
    .withMessage('Action must be one of: delete, activate, deactivate, update-status'),
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

    default:
      throw createError.badRequest('Invalid action');
  }

  res.json(result);
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

  // Find an available DID for this tenant
  // Simple implementation - you can make this more sophisticated
  const did = await DID.findOne({
    tenantId: req.tenant._id,
    status: 'active',
    $or: [
      { lastUsed: null },
      { lastUsed: { $lt: new Date(Date.now() - 60 * 60 * 1000) } } // Not used in last hour
    ]
  }).sort({ lastUsed: 1 });

  if (!did) {
    // Return fallback DID if no DIDs available
    return res.json({
      success: true,
      did: {
        number: process.env.FALLBACK_DID || '+18005551234',
        is_fallback: true
      }
    });
  }

  // Update last used timestamp
  did.lastUsed = new Date();
  did.usageCount = (did.usageCount || 0) + 1;
  await did.save();

  // Return the DID in VICIdial format
  res.json({
    success: true,
    did: {
      number: did.phoneNumber,
      description: did.description,
      carrier: did.carrier,
      location: did.location,
      is_fallback: false
    },
    metadata: {
      campaign_id,
      agent_id,
      timestamp: new Date().toISOString()
    }
  });
}));

export default router;