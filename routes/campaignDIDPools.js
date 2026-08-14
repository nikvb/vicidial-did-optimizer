import express from 'express';
import { body, validationResult, param } from 'express-validator';
import CampaignDIDPool from '../models/CampaignDIDPool.js';
import DID from '../models/DID.js';
import Campaign from '../models/Campaign.js';
import { asyncHandler, createError } from '../middleware/errorHandler.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// @desc    Get all campaign DID pools for tenant
// @route   GET /api/v1/campaign-did-pools
// @access  Private
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 25;
  const status = req.query.status;
  const tenantId = req.user.tenant._id;

  const [pools, total] = await Promise.all([
    CampaignDIDPool.listByTenant(tenantId, { status, page, limit }).populate('dids'),
    CampaignDIDPool.countDocuments({ tenantId })
  ]);

  const totalPages = Math.ceil(total / limit);

  res.json({
    success: true,
    data: pools,
    pagination: {
      current: page,
      pages: totalPages,
      total,
      limit,
      hasNext: page < totalPages,
      hasPrev: page > 1
    }
  });
}));

// @desc    Get campaign DID pool by ID
// @route   GET /api/v1/campaign-did-pools/:id
// @access  Private
router.get('/:id', authenticate, [
  param('id').isMongoId().withMessage('Invalid pool ID')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw createError.badRequest(errors.array()[0].msg);
  }

  const pool = await CampaignDIDPool.findOne({
    _id: req.params.id,
    tenantId: req.user.tenant._id
  }).populate('dids');

  if (!pool) {
    throw createError.notFound('Campaign DID pool not found');
  }

  res.json({
    success: true,
    data: pool
  });
}));

// @desc    Create new campaign DID pool
// @route   POST /api/v1/campaign-did-pools
// @access  Private
router.post('/', authenticate, [
  body('campaignId')
    .notEmpty()
    .trim()
    .withMessage('Campaign ID is required'),
  body('campaignName')
    .notEmpty()
    .trim()
    .withMessage('Campaign name is required'),
  body('rotationStrategy.type')
    .optional()
    .isIn(['round-robin', 'least-used', 'performance-based', 'geographic'])
    .withMessage('Invalid rotation strategy'),
  body('rotationStrategy.config.dailyLimit')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Daily limit must be a positive integer'),
  body('rotationStrategy.config.maxDistance')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Max distance must be a non-negative integer'),
  body('rotationStrategy.config.minReputationScore')
    .optional()
    .isInt({ min: 0, max: 100 })
    .withMessage('Min reputation score must be between 0 and 100'),
  body('fallback.enabled')
    .optional()
    .isBoolean()
    .withMessage('Fallback enabled must be a boolean'),
  body('fallback.fallbackToTenantPool')
    .optional()
    .isBoolean()
    .withMessage('Fallback to tenant pool must be a boolean'),
  body('fallback.fallbackDid')
    .optional()
    .matches(/^[\+]?[1-9][\d\s\-()]*$/)
    .withMessage('Invalid fallback DID format')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw createError.badRequest(errors.array()[0].msg);
  }

  const tenantId = req.user.tenant._id;

  // Check if pool already exists for this campaign
  const existingPool = await CampaignDIDPool.findByCampaign(tenantId, req.body.campaignId);
  if (existingPool) {
    throw createError.conflict('Campaign DID pool already exists for this campaign');
  }

  // Verify campaign exists
  const campaign = await Campaign.findOne({
    campaignId: req.body.campaignId,
    tenantId
  });

  if (!campaign) {
    throw createError.notFound('Campaign not found');
  }

  const pool = await CampaignDIDPool.create({
    tenantId,
    campaignId: req.body.campaignId,
    campaignName: req.body.campaignName,
    rotationStrategy: req.body.rotationStrategy || {
      type: 'round-robin',
      config: {}
    },
    fallback: req.body.fallback || {
      enabled: true,
      fallbackToTenantPool: true
    },
    createdBy: req.user._id
  });

  // Update campaign with pool reference
  campaign.didPool = {
    enabled: true,
    poolId: pool._id,
    rotationStrategy: pool.rotationStrategy,
    fallback: pool.fallback
  };
  await campaign.save();

  res.status(201).json({
    success: true,
    data: pool
  });
}));

// @desc    Update campaign DID pool
// @route   PUT /api/v1/campaign-did-pools/:id
// @access  Private
router.put('/:id', authenticate, [
  param('id').isMongoId().withMessage('Invalid pool ID'),
  body('rotationStrategy.type')
    .optional()
    .isIn(['round-robin', 'least-used', 'performance-based', 'geographic'])
    .withMessage('Invalid rotation strategy'),
  body('rotationStrategy.config.dailyLimit')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Daily limit must be a positive integer'),
  body('rotationStrategy.config.maxDistance')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Max distance must be a non-negative integer'),
  body('rotationStrategy.config.minReputationScore')
    .optional()
    .isInt({ min: 0, max: 100 })
    .withMessage('Min reputation score must be between 0 and 100'),
  body('status.type')
    .optional()
    .isIn(['active', 'paused', 'exhausted'])
    .withMessage('Invalid status type'),
  body('fallback.enabled')
    .optional()
    .isBoolean()
    .withMessage('Fallback enabled must be a boolean'),
  body('fallback.fallbackToTenantPool')
    .optional()
    .isBoolean()
    .withMessage('Fallback to tenant pool must be a boolean'),
  body('fallback.fallbackDid')
    .optional()
    .matches(/^[\+]?[1-9][\d\s\-()]*$/)
    .withMessage('Invalid fallback DID format')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw createError.badRequest(errors.array()[0].msg);
  }

  const pool = await CampaignDIDPool.findOne({
    _id: req.params.id,
    tenantId: req.user.tenant._id
  });

  if (!pool) {
    throw createError.notFound('Campaign DID pool not found');
  }

  // Update allowed fields
  const allowedUpdates = ['rotationStrategy', 'status', 'fallback'];
  allowedUpdates.forEach(field => {
    if (req.body[field] !== undefined) {
      pool[field] = req.body[field];
    }
  });

  pool.updatedBy = req.user._id;
  await pool.save();

  // Update campaign if pool settings changed
  if (req.body.rotationStrategy || req.body.fallback) {
    const campaign = await Campaign.findOne({
      campaignId: pool.campaignId,
      tenantId: req.user.tenant._id
    });

    if (campaign && campaign.didPool) {
      campaign.didPool.rotationStrategy = pool.rotationStrategy;
      campaign.didPool.fallback = pool.fallback;
      await campaign.save();
    }
  }

  res.json({
    success: true,
    data: pool
  });
}));

// @desc    Delete campaign DID pool
// @route   DELETE /api/v1/campaign-did-pools/:id
// @access  Private
router.delete('/:id', authenticate, [
  param('id').isMongoId().withMessage('Invalid pool ID')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw createError.badRequest(errors.array()[0].msg);
  }

  const pool = await CampaignDIDPool.findOne({
    _id: req.params.id,
    tenantId: req.user.tenant._id
  });

  if (!pool) {
    throw createError.notFound('Campaign DID pool not found');
  }

  // Remove campaign associations from DIDs
  await DID.updateMany(
    { _id: { $in: pool.dids } },
    {
      $pull: {
        campaignAssociations: { poolId: pool._id }
      }
    }
  );

  // Update campaign
  const campaign = await Campaign.findOne({
    campaignId: pool.campaignId,
    tenantId: req.user.tenant._id
  });

  if (campaign) {
    campaign.didPool.enabled = false;
    campaign.didPool.poolId = null;
    await campaign.save();
  }

  await pool.deleteOne();

  res.json({
    success: true,
    message: 'Campaign DID pool deleted successfully'
  });
}));

// @desc    Get DIDs in campaign pool
// @route   GET /api/v1/campaign-did-pools/:id/dids
// @access  Private
router.get('/:id/dids', authenticate, [
  param('id').isMongoId().withMessage('Invalid pool ID')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw createError.badRequest(errors.array()[0].msg);
  }

  const pool = await CampaignDIDPool.findOne({
    _id: req.params.id,
    tenantId: req.user.tenant._id
  });

  if (!pool) {
    throw createError.notFound('Campaign DID pool not found');
  }

  const dids = await DID.find({
    _id: { $in: pool.dids },
    tenantId: req.user.tenant._id
  });

  res.json({
    success: true,
    data: dids,
    count: dids.length
  });
}));

// @desc    Add DIDs to campaign pool
// @route   POST /api/v1/campaign-did-pools/:id/dids
// @access  Private
router.post('/:id/dids', authenticate, [
  param('id').isMongoId().withMessage('Invalid pool ID'),
  body('didIds')
    .isArray({ min: 1 })
    .withMessage('didIds must be a non-empty array'),
  body('didIds.*')
    .isMongoId()
    .withMessage('Each DID ID must be a valid MongoDB ObjectId'),
  body('priority')
    .optional()
    .isInt({ min: 1, max: 10 })
    .withMessage('Priority must be between 1 and 10')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw createError.badRequest(errors.array()[0].msg);
  }

  const { didIds, priority = 5 } = req.body;
  const tenantId = req.user.tenant._id;

  const pool = await CampaignDIDPool.findOne({
    _id: req.params.id,
    tenantId
  });

  if (!pool) {
    throw createError.notFound('Campaign DID pool not found');
  }

  // Verify all DIDs belong to this tenant
  const dids = await DID.find({
    _id: { $in: didIds },
    tenantId
  });

  if (dids.length !== didIds.length) {
    throw createError.badRequest('Some DIDs not found or do not belong to your tenant');
  }

  // Add DIDs to pool (avoid duplicates)
  const poolDidStrings = pool.dids.map(id => id.toString());
  const newDidIds = didIds.filter(id => !poolDidStrings.includes(id.toString()));
  pool.dids.push(...newDidIds);
  pool.poolSize = pool.dids.length;
  pool.updatedBy = req.user._id;
  await pool.save();

  // Add campaign associations to DIDs
  for (const did of dids) {
    const existingAssociation = did.campaignAssociations.find(
      assoc => assoc.campaignId === pool.campaignId
    );

    if (!existingAssociation) {
      did.campaignAssociations.push({
        campaignId: pool.campaignId,
        poolId: pool._id,
        addedAt: new Date(),
        addedBy: req.user._id,
        priority
      });
      await did.save();
    }
  }

  // Update pool stats
  await pool.updateStats();

  res.json({
    success: true,
    message: `Added ${newDidIds.length} DIDs to campaign pool`,
    data: pool
  });
}));

// @desc    Remove DIDs from campaign pool
// @route   DELETE /api/v1/campaign-did-pools/:id/dids
// @access  Private
router.delete('/:id/dids', authenticate, [
  param('id').isMongoId().withMessage('Invalid pool ID'),
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

  const { didIds } = req.body;
  const tenantId = req.user.tenant._id;

  const pool = await CampaignDIDPool.findOne({
    _id: req.params.id,
    tenantId
  });

  if (!pool) {
    throw createError.notFound('Campaign DID pool not found');
  }

  // Remove DIDs from pool
  const removeSet = new Set(didIds.map(id => id.toString()));
  pool.dids = pool.dids.filter(id => !removeSet.has(id.toString()));
  pool.poolSize = pool.dids.length;
  pool.updatedBy = req.user._id;
  await pool.save();

  // Remove campaign associations from DIDs
  await DID.updateMany(
    { _id: { $in: didIds } },
    {
      $pull: {
        campaignAssociations: {
          campaignId: pool.campaignId,
          poolId: pool._id
        }
      }
    }
  );

  // Update pool stats
  await pool.updateStats();

  res.json({
    success: true,
    message: `Removed ${didIds.length} DIDs from campaign pool`,
    data: pool
  });
}));

// @desc    Manually trigger rotation
// @route   POST /api/v1/campaign-did-pools/:id/rotate
// @access  Private
router.post('/:id/rotate', authenticate, [
  param('id').isMongoId().withMessage('Invalid pool ID')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw createError.badRequest(errors.array()[0].msg);
  }

  const pool = await CampaignDIDPool.findOne({
    _id: req.params.id,
    tenantId: req.user.tenant._id
  });

  if (!pool) {
    throw createError.notFound('Campaign DID pool not found');
  }

  // Reset rotation index
  pool.status.currentIndex = 0;
  pool.status.lastRotatedAt = new Date();
  pool.updatedBy = req.user._id;
  await pool.save();

  res.json({
    success: true,
    message: 'Pool rotation reset successfully',
    data: pool
  });
}));

// @desc    Get pool statistics
// @route   GET /api/v1/campaign-did-pools/:id/stats
// @access  Private
router.get('/:id/stats', authenticate, [
  param('id').isMongoId().withMessage('Invalid pool ID')
], asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw createError.badRequest(errors.array()[0].msg);
  }

  const pool = await CampaignDIDPool.findOne({
    _id: req.params.id,
    tenantId: req.user.tenant._id
  });

  if (!pool) {
    throw createError.notFound('Campaign DID pool not found');
  }

  // Get detailed statistics
  const activeDIDs = await pool.getActiveDIDs();
  const isExhausted = await pool.isExhausted();

  // Calculate DID usage statistics
  const didStats = await Promise.all(activeDIDs.map(async (did) => ({
    phoneNumber: did.phoneNumber,
    totalCalls: did.usage?.totalCalls || 0,
    todayUsage: did.getTodayUsage(),
    reputationScore: did.reputation?.score || 50,
    lastUsed: did.usage?.lastUsed
  })));

  res.json({
    success: true,
    data: {
      pool: {
        id: pool._id,
        campaignId: pool.campaignId,
        campaignName: pool.campaignName,
        poolSize: pool.poolSize,
        activeDids: pool.activeDids,
        status: pool.status.type
      },
      stats: pool.stats,
      isExhausted,
      dids: didStats,
      rotationStrategy: pool.rotationStrategy,
      fallback: pool.fallback
    }
  });
}));

export default router;
