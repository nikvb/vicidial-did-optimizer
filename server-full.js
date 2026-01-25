import dotenv from 'dotenv';
dotenv.config();

import pg from 'pg';
const { Pool } = pg;

// ===== LOGGING CONFIGURATION =====
const LOG_LEVEL = process.env.LOG_LEVEL || 'info'; // debug, info, warn, error
const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const CURRENT_LEVEL = LOG_LEVELS[LOG_LEVEL] || LOG_LEVELS.info;

const logger = {
  debug: (...args) => CURRENT_LEVEL <= LOG_LEVELS.debug && console.log(...args),
  info: (...args) => CURRENT_LEVEL <= LOG_LEVELS.info && console.log(...args),
  warn: (...args) => CURRENT_LEVEL <= LOG_LEVELS.warn && console.warn(...args),
  error: (...args) => CURRENT_LEVEL <= LOG_LEVELS.error && console.error(...args),
};

console.log(`🔧 Log level: ${LOG_LEVEL.toUpperCase()} (showing: ${Object.keys(LOG_LEVELS).filter(l => LOG_LEVELS[l] >= CURRENT_LEVEL).join(', ')})`);

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
// import mongoSanitize from 'express-mongo-sanitize'; // Commented out - incompatible with Express 5
import session from 'express-session';
import MongoStore from 'connect-mongo';
import mongoose from 'mongoose';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import jsonwebtoken from 'jsonwebtoken';
import path from 'path';
import { fileURLToPath } from 'url';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { Resend } from 'resend';
import crypto from 'crypto';
import multer from 'multer';
import fetch from 'node-fetch';

// Get __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Frontend build path
const frontendBuildPath = path.join(__dirname, 'frontend');

// Initialize Resend
const resend = new Resend(process.env.RESEND_API_KEY);

// Import middleware
import { errorHandler, notFound } from './middleware/errorHandler.js';

// Import passport configuration AFTER dotenv
// import './config/passport.js'; // Commented out - passport config included inline

// IMPORTANT: Import models BEFORE routes so mongoose.model() works in route files
import User from './models/User.js';
import Tenant from './models/Tenant.js';
import DID from './models/DID.js';
import CallRecord from './models/CallRecord.js';
import AuditLog from './models/AuditLog.js';
import AreaCodeLocation from './models/AreaCodeLocation.js';
import Invoice from './models/Invoice.js';

// Import routes AFTER models are registered
// import authRoutes from './routes/auth.js';
// import userRoutes from './routes/users.js';
import didRoutes from './temp_clone/routes/dids.js';
// import analyticsRoutes from './routes/analytics.js';
import billingRoutes from './routes/billing.js';
import tenantRoutes from './temp_clone/routes/tenants.js';
import vicidialRoutes from './routes/vicidial.js';
// import dashboardRoutes from './routes/dashboard.js';

// Import billing jobs
import { startAllBillingJobs } from './services/billing/monthlyBilling.js';

// API key validation middleware using the same DB connection
const validateApiKey = async (req, res, next) => {
  try {
    console.log('🔍 API Key Validation - Headers:', req.headers);
    const apiKey = req.headers['x-api-key'];

    console.log('🔑 API Key received:', apiKey ? `${apiKey.substring(0, 8)}...` : 'NONE');

    if (!apiKey) {
      console.log('❌ No API key provided');
      return res.status(401).json({
        success: false,
        message: 'API key required'
      });
    }

    console.log('🔍 Looking up tenant for API key...');
    const tenant = await Tenant.findOne({
      'apiKeys.key': apiKey,
      'apiKeys.isActive': true,
      isActive: true
    });

    if (!tenant) {
      console.log('❌ No tenant found for API key');
      return res.status(401).json({
        success: false,
        message: 'Invalid API key'
      });
    }

    console.log('✅ Tenant found:', tenant.name, 'ID:', tenant._id);

    // Update last used timestamp
    const apiKeyObj = tenant.apiKeys.find(key => key.key === apiKey);
    if (apiKeyObj) {
      apiKeyObj.lastUsed = new Date();
      await tenant.save();
      console.log('✅ API key last used timestamp updated');
    }

    req.tenant = tenant;
    req.apiKey = apiKeyObj;
    next();
  } catch (error) {
    console.error('💥 API key validation error:', error);
    return res.status(500).json({
      success: false,
      message: 'API key validation failed',
      error: error.message
    });
  }
};

const app = express();
const PORT = process.env.PORT || 3000;

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/did-optimizer')
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => {
    console.error('❌ MongoDB connection error:', err);
    console.log('⚠️ Running without database connection...');
  });

// TimescaleDB connection pool for analytics
const timescalePool = new Pool({
  connectionString: process.env.TIMESCALE_URI || 'postgresql://postgres@localhost:5432/did_analytics',
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

timescalePool.on('connect', () => {
  console.log('✅ TimescaleDB pool connected');
});

timescalePool.on('error', (err) => {
  console.error('❌ TimescaleDB pool error:', err.message);
});

// Test TimescaleDB connection
timescalePool.query('SELECT NOW()')
  .then(() => console.log('✅ TimescaleDB connection verified'))
  .catch(err => console.warn('⚠️ TimescaleDB not available:', err.message));

// Helper function to get location data from area code
async function getLocationByAreaCode(areaCode) {
  if (!areaCode || areaCode.length !== 3) {
    return { state: 'Unknown', city: 'Unknown' };
  }

  try {
    const location = await AreaCodeLocation.findOne({ areaCode });
    if (location) {
      return {
        state: location.state,
        city: location.city,
        country: location.country || 'US'
      };
    }
  } catch (error) {
    console.error('Error fetching location data:', error);
  }

  return { state: 'Unknown', city: 'Unknown' };
}

// Trust proxy (for deployment behind reverse proxy)
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

// Enable CORS
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, automated tests)
    if (!origin) return callback(null, true);

    const allowedOrigins = [
      'https://dids.amdy.io',
      'https://endpoint.amdy.io',
      process.env.FRONTEND_URL || 'https://dids.amdy.io',
      'http://localhost:3000',
      'http://localhost:5000'
    ];
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error('Not allowed by CORS'), false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key']
}));

app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
// app.use(mongoSanitize()); // Commented out - incompatible with Express 5

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.toLowerCase().endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'), false);
    }
  }
});

// Serve static frontend build files
app.use(express.static(frontendBuildPath));

// Serve screenshots for reputation debugging
app.use('/screenshots', express.static(path.join(__dirname, 'public', 'screenshots')));

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-session-secret',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/did-optimizer',
    touchAfter: 24 * 3600,
    mongoOptions: {
      serverSelectionTimeoutMS: 5000
    }
  }),
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  }
}));

// Passport middleware
app.use(passport.initialize());
app.use(passport.session());

// Rate limiting for API routes only
const limiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: 'Too many requests from this IP, please try again later.',
  // Skip rate limiting for VICIdial server and localhost
  skip: (req) => {
    const ip = req.ip || req.connection.remoteAddress;
    const whitelistedIPs = [
      '204.12.211.2',  // VICIdial server
      '::1',           // localhost IPv6
      '127.0.0.1',     // localhost IPv4
      '::ffff:127.0.0.1' // localhost IPv4 mapped to IPv6
    ];
    return whitelistedIPs.some(whitelistedIP => ip.includes(whitelistedIP));
  }
});

app.use('/api/', limiter);

// DEBUG: Log ALL API requests
app.use('/api', (req, res, next) => {
  console.log('🌐 API REQUEST:', req.method, req.url, 'from', req.ip);
  next();
});

// VICIdial API endpoint (before session middleware)

// VICIdial API endpoint - bypasses session auth
app.get('/api/v1/dids/next', validateApiKey, async (req, res) => {
  const requestStartTime = Date.now();
  logger.info('🎯 VICIdial DID Next endpoint called');
  logger.debug('📊 Query params:', req.query);
  logger.debug('🏢 Tenant:', req.tenant?.name, 'ID:', req.tenant?._id);

  const timings = {};

  try {
    const {
      campaign_id,
      agent_id,
      caller_id,
      customer_state,
      customer_area_code,
      customer_phone
    } = req.query;

    // Find an available DID for this tenant
    logger.debug('🔍 Searching for DIDs with query:');
    logger.debug('   Tenant ID:', req.tenant._id);
    logger.debug('   Status: active');

    // Enhanced Round-Robin Rotation Algorithm
    // Reload tenant to get latest rotation state
    const tenantQueryStart = Date.now();
    const freshTenant = await Tenant.findById(req.tenant._id);
    timings.tenantQuery = Date.now() - tenantQueryStart;
    logger.debug(`⏱️ Tenant query: ${timings.tenantQuery}ms`);
    logger.debug('🔍 Fresh tenant rotation state from DB:', freshTenant.rotationState);

    let rotationState = freshTenant.rotationState || {
      currentIndex: 0,
      lastReset: new Date(),
      usedDidsInCycle: []
    };

    // Initialize usedDidsInCycle as a Set for processing
    const usedDidsSet = new Set(rotationState.usedDidsInCycle || []);

    // Reset cycle if all DIDs have been used or it's been more than 24 hours
    const countQueryStart = Date.now();
    const activeDids = await DID.countDocuments({ tenantId: req.tenant._id, status: 'active' });
    const goodReputationDids = await DID.countDocuments({
      tenantId: req.tenant._id,
      status: 'active',
      'reputation.score': { $gte: 50 }
    });
    timings.countQueries = Date.now() - countQueryStart;
    logger.debug(`⏱️ Count queries: ${timings.countQueries}ms`);

    const shouldResetCycle = usedDidsSet.size >= goodReputationDids ||
                            (new Date() - new Date(rotationState.lastReset)) > 24 * 60 * 60 * 1000;

    if (shouldResetCycle) {
      logger.debug('🔄 Resetting rotation cycle - starting fresh round');
      usedDidsSet.clear();
      rotationState.currentIndex = 0;
      rotationState.lastReset = new Date();
    }

    logger.debug('🎯 Rotation State:', {
      currentIndex: rotationState.currentIndex,
      usedInCycle: usedDidsSet.size,
      totalActive: activeDids,
      goodReputation: goodReputationDids
    });

    // FAST: Just sort by lastUsed (indexed field) instead of calculating usage
    // This avoids the expensive $reduce operation on 3,174 DIDs
    const getLeastUsedDID = async (baseQuery) => {
      // Find DIDs sorted by lastUsed (oldest first = least recently used)
      const dids = await DID.find(baseQuery)
        .sort({ 'usage.lastUsed': 1, 'reputation.score': -1, createdAt: 1 })
        .limit(1)
        .lean();

      return dids[0] || null;
    };

    // NEW STRATEGY: Always select DID with least usage (no capacity filtering)
    // Priority order:
    // 1. State + NPANXX match (if customer data provided)
    // 2. State match only (if customer state provided)
    // 3. Any active DID with good reputation (≥50)
    // 4. Any active DID

    let query = {
      tenantId: req.tenant._id,
      status: 'active'
    };

    let selectedDidObj = null;
    let did = null;
    const findQueryStart = Date.now();

    // Try geographic matching if customer data is available
    if (customer_state && customer_phone) {
      // Extract NPANXX (first 6 digits) from customer phone
      const npanxx = customer_phone.replace(/\D/g, '').substring(0, 6);

      if (npanxx.length === 6) {
        logger.debug(`🌍 Trying geographic match: State=${customer_state}, NPANXX=${npanxx}`);

        // Try state + NPANXX match first
        const geoQuery = {
          ...query,
          state: customer_state,
          npanxx: npanxx,
          'reputation.score': { $gte: 50 }
        };

        selectedDidObj = await getLeastUsedDID(geoQuery);
        if (selectedDidObj) {
          logger.info(`✅ Geographic match found: State + NPANXX match`);
        } else {
          // Try state-only match
          logger.debug(`🌍 No NPANXX match, trying state-only: ${customer_state}`);
          const stateQuery = {
            ...query,
            state: customer_state,
            'reputation.score': { $gte: 50 }
          };
          selectedDidObj = await getLeastUsedDID(stateQuery);
          if (selectedDidObj) {
            logger.info(`✅ Geographic match found: State-only match`);
          }
        }
      }
    }

    // If no geographic match, use any active DID with good reputation
    if (!selectedDidObj) {
      logger.debug('🔄 No geographic match, selecting least-used DID with good reputation');
      const goodRepQuery = {
        ...query,
        'reputation.score': { $gte: 50 }
      };
      selectedDidObj = await getLeastUsedDID(goodRepQuery);
    }

    // Last resort: any active DID
    if (!selectedDidObj) {
      logger.debug('⚠️ No good reputation DIDs, using any active DID');
      selectedDidObj = await getLeastUsedDID(query);
    }

    timings.findQuery = Date.now() - findQueryStart;

    // Fetch full Mongoose document (we have lean() object, need full document for save())
    did = selectedDidObj ? await DID.findById(selectedDidObj._id) : null;

    // Check total DIDs for this tenant
    const totalDids = await DID.countDocuments({ tenantId: req.tenant._id });

    logger.debug('📊 DID Statistics:');
    logger.debug('   Total DIDs for tenant:', totalDids);
    logger.debug('   Active DIDs for tenant:', activeDids);
    logger.debug('   Good reputation DIDs (≥50):', goodReputationDids);
    logger.debug('   Bad reputation DIDs (<50):', activeDids - goodReputationDids);

    // CRITICAL: Should always have a DID now with least-used strategy
    if (!did) {
      logger.error('❌ CRITICAL: No active DIDs found in database!');
      return res.status(500).json({
        success: false,
        error: 'No DIDs available. Please add DIDs to your pool.',
        fallback: {
          number: process.env.FALLBACK_DID || '+18005551234',
          is_fallback: true
        }
      });
    }

    // Check if DID is over capacity and log/track accordingly
    const currentUsage = did.getTodayUsage();
    const defaultCapacity = parseInt(process.env.DEFAULT_DID_CAPACITY || '100', 10);
    const capacity = did.capacity || defaultCapacity;
    const isOverCapacity = (currentUsage >= capacity);

    if (isOverCapacity) {
      logger.warn(`⚠️ CAPACITY EXCEEDED: ${did.phoneNumber} has ${currentUsage} calls (capacity: ${capacity})`);
      logger.warn(`   Continuing with least-used DID strategy - no shortage disruption`);

      // Send email notification about capacity exhaustion (throttled to once per hour)
      const lastNotificationKey = `capacity_notification_${req.tenant._id}`;
      const lastNotification = global[lastNotificationKey] || 0;
      const hourAgo = Date.now() - (60 * 60 * 1000);

      if (lastNotification < hourAgo) {
        global[lastNotificationKey] = Date.now();

        try {
          const adminUsers = await User.find({
            tenantId: req.tenant._id,
            role: 'ADMIN'
          });

          const adminEmails = adminUsers.map(u => u.email).filter(Boolean);

          if (adminEmails.length > 0) {
            await resend.emails.send({
              from: process.env.FROM_EMAIL || 'DID Optimizer <noreply@amdy.io>',
              to: adminEmails,
              subject: '⚠️ DID Pool Operating Over Capacity',
              html: `
                <h2 style="color: #f59e0b;">DID Pool Operating Over Capacity</h2>
                <p>Your DID pool is handling calls beyond the configured capacity limits.</p>
                <p><strong>Campaign:</strong> ${campaign_id || 'Unknown'}</p>
                <p><strong>Time:</strong> ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })}</p>
                <p><strong>Current Strategy:</strong> Using least-used DIDs (${did.phoneNumber} - ${currentUsage} calls today)</p>
                <p style="color: #10b981; font-weight: 600;">✓ All calls are being handled normally - no disruption to operations.</p>
                <hr style="margin: 20px 0; border: none; border-top: 1px solid #e5e7eb;">
                <p style="color: #6b7280; font-size: 14px;">
                  To optimize performance, consider:
                  <ul>
                    <li>Increasing DEFAULT_DID_CAPACITY (currently ${defaultCapacity} calls/DID/day)</li>
                    <li>Adding more DIDs to your pool</li>
                    <li>Reviewing your <a href="${process.env.FRONTEND_URL || 'https://dids.amdy.io'}/analytics">daily usage patterns</a></li>
                  </ul>
                </p>
              `
            });
            logger.info('📧 Over-capacity notification sent to admins');
          }
        } catch (emailError) {
          logger.error('❌ Failed to send capacity notification:', emailError);
        }
      }
    } else {
      logger.info('🎯 DID Selected:', `${did.phoneNumber} (Usage: ${currentUsage}/${capacity}, Reputation: ${did.reputation?.score || 'N/A'})`);
    }

    // Update rotation state atomically (no locks, no contention!)
    const tenantSaveStart = Date.now();
    const updatedTenant = await Tenant.findByIdAndUpdate(
      req.tenant._id,
      {
        $set: {
          'rotationState.currentIndex': (rotationState.currentIndex + 1) % activeDids,
          'rotationState.lastReset': rotationState.lastReset
        },
        $addToSet: {
          'rotationState.usedDidsInCycle': did._id.toString()
        }
      },
      { new: true } // Return updated document
    );
    timings.tenantSave = Date.now() - tenantSaveStart;
    logger.debug(`⏱️ Tenant atomic update: ${timings.tenantSave}ms`);
    logger.debug('✅ Rotation state updated atomically');

    // Update last used timestamp and usage tracking
    const now = new Date();

    // Initialize usage object if it doesn't exist
    if (!did.usage) {
      did.usage = {
        totalCalls: 0,
        dailyUsage: [],
        lastUsed: null,
        lastCampaign: null,
        lastAgent: null
      };
    }

    did.usage.lastUsed = now;
    did.usage.totalCalls = (did.usage.totalCalls || 0) + 1;
    did.usage.lastCampaign = campaign_id;
    did.usage.lastAgent = agent_id;

    // Increment today's usage count for daily limit tracking
    did.incrementTodayUsage();

    const todayUsage = did.getTodayUsage();
    // Reuse defaultCapacity and capacity from earlier
    const dailyCapacity = capacity;

    logger.debug('📝 Updating DID usage:', {
      did: did.phoneNumber,
      didId: did._id,
      oldLastUsed: did.usage.lastUsed,
      newLastUsed: now,
      totalCalls: did.usage.totalCalls,
      todayUsage: todayUsage,
      dailyCapacity: dailyCapacity,
      percentageUsed: `${Math.round((todayUsage / dailyCapacity) * 100)}%`,
      campaign: campaign_id,
      agent: agent_id
    });

    try {
      const didSaveStart = Date.now();
      const savedDid = await did.save();
      timings.didSave = Date.now() - didSaveStart;
      logger.debug(`⏱️ DID save: ${timings.didSave}ms`);
      logger.debug('✅ DID usage updated successfully:', {
        id: savedDid._id,
        phone: savedDid.phoneNumber,
        lastUsed: savedDid.usage?.lastUsed,
        totalCalls: savedDid.usage?.totalCalls
      });
    } catch (saveError) {
      logger.error('❌ ERROR saving DID usage:', saveError);
      logger.error('❌ DID object:', JSON.stringify(did, null, 2));
    }

    // Create call record for tracking (will be updated later with final disposition)
    const uniqueid = req.headers['x-request-id'] || ''; // From AGI script

    const callRecord = new CallRecord({
      didId: did._id,
      tenantId: req.tenant._id,
      phoneNumber: customer_phone || 'unknown',
      callTimestamp: new Date(),
      duration: 0, // Will be updated when call completes
      result: 'answered', // Default - will be updated when call completes
      disposition: 'initiated', // Initial state
      campaignId: campaign_id,
      agentId: agent_id,
      customerState: customer_state,
      customerAreaCode: customer_area_code,
      metadata: {
        callDirection: 'outbound',
        recording: false,
        uniqueid: uniqueid, // Store uniqueid for matching with call results
        source: 'did-selection'
      }
    });
    const callRecordSaveStart = Date.now();
    await callRecord.save();
    timings.callRecordSave = Date.now() - callRecordSaveStart;
    logger.debug(`⏱️ CallRecord save: ${timings.callRecordSave}ms`);

    logger.debug('📞 Call record created:', callRecord._id, '| Uniqueid:', uniqueid, '| DID:', did.phoneNumber);

    console.log('✅ Rotation state updated:', {
      selectedDID: did.phoneNumber,
      newIndex: rotationState.currentIndex,
      usedInCycle: usedDidsSet.size,
      totalActive: activeDids
    });

    // Calculate total request time
    timings.total = Date.now() - requestStartTime;
    const queryTime = (timings.tenantQuery || 0) + (timings.countQueries || 0) + (timings.findQuery || 0);
    const saveTime = (timings.tenantSave || 0) + (timings.didSave || 0) + (timings.callRecordSave || 0);
    const otherTime = timings.total - queryTime - saveTime;

    logger.info('\n⏱️ ===== PERFORMANCE SUMMARY =====');
    logger.info(`   Total request time: ${timings.total}ms`);
    logger.debug(`\n   Read Operations (${queryTime}ms):`);
    logger.debug(`   - Tenant query: ${timings.tenantQuery}ms`);
    logger.debug(`   - Count queries: ${timings.countQueries}ms`);
    logger.debug(`   - Find query: ${timings.findQuery}ms`);
    logger.debug(`\n   Write Operations (${saveTime}ms):`);
    logger.debug(`   - Tenant save: ${timings.tenantSave || 0}ms`);
    logger.debug(`   - DID save: ${timings.didSave || 0}ms`);
    logger.debug(`   - CallRecord save: ${timings.callRecordSave || 0}ms`);
    logger.debug(`\n   Other operations: ${otherTime}ms`);
    logger.info('=================================\n');

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
  } catch (error) {
    logger.error('💥 VICIdial API error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

// VICIdial Call Result Reporting endpoint
app.post('/api/v1/calls/report', validateApiKey, async (req, res) => {
  console.log('📞 Call result report received');
  console.log('📊 Report data:', req.body);

  try {
    const {
      campaign_id,
      customer_phone,
      call_result,
      call_duration,
      disposition,
      timestamp,
      uniqueid,
      channel,
      callerid
    } = req.body;

    // Validate required fields
    if (!campaign_id || !customer_phone) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: campaign_id and customer_phone are required'
      });
    }

    // Find the call record to update (most recent for this campaign and phone)
    const callRecord = await CallRecord.findOne({
      tenantId: req.tenant._id,
      campaignId: campaign_id,
      phoneNumber: customer_phone
    }).sort({ callTimestamp: -1 });

    if (!callRecord) {
      console.log('⚠️  No call record found for update, creating new one');

      // Create a new call record with the result
      const newCallRecord = new CallRecord({
        tenantId: req.tenant._id,
        phoneNumber: customer_phone,
        callTimestamp: timestamp ? new Date(timestamp * 1000) : new Date(),
        duration: call_duration || 0,
        result: call_result === 'ANSWER' || call_result === 'ANSWERED' ? 'answered' :
                call_result === 'BUSY' ? 'busy' :
                call_result === 'NOANSWER' || call_result === 'NO ANSWER' ? 'no_answer' :
                call_result === 'FAILED' || call_result === 'CANCEL' ? 'failed' :
                'dropped',
        disposition: disposition || 'completed',
        campaignId: campaign_id,
        metadata: {
          callDirection: 'outbound',
          recording: false,
          uniqueid: uniqueid,
          channel: channel,
          callerid: callerid,
          source: 'vicidial-agi'
        }
      });

      await newCallRecord.save();
      console.log('✅ New call record created with result:', newCallRecord._id);

      return res.json({
        success: true,
        message: 'Call result recorded (new record)',
        call_id: newCallRecord._id
      });
    }

    // Update existing call record
    callRecord.duration = call_duration || callRecord.duration;
    callRecord.result = call_result === 'ANSWER' || call_result === 'ANSWERED' ? 'answered' :
                        call_result === 'BUSY' ? 'busy' :
                        call_result === 'NOANSWER' || call_result === 'NO ANSWER' ? 'no_answer' :
                        call_result === 'FAILED' || call_result === 'CANCEL' ? 'failed' :
                        'dropped';
    callRecord.disposition = disposition || callRecord.disposition;

    // Update metadata
    if (!callRecord.metadata) callRecord.metadata = {};
    if (uniqueid) callRecord.metadata.uniqueid = uniqueid;
    if (channel) callRecord.metadata.channel = channel;
    if (callerid) callRecord.metadata.callerid = callerid;
    callRecord.metadata.source = 'vicidial-agi';
    callRecord.metadata.reportedAt = new Date();

    await callRecord.save();

    console.log('✅ Call record updated with result:', {
      callId: callRecord._id,
      result: callRecord.result,
      duration: callRecord.duration,
      disposition: callRecord.disposition
    });

    res.json({
      success: true,
      message: 'Call result updated successfully',
      call_id: callRecord._id,
      updated: {
        result: callRecord.result,
        duration: callRecord.duration,
        disposition: callRecord.disposition
      }
    });

  } catch (error) {
    console.error('💥 Call result reporting error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

// VICIdial Call Results Sync endpoint (from vicidial_log polling)
app.post('/api/v1/call-results', validateApiKey, async (req, res) => {
  const requestStart = Date.now();
  console.log('📞 [CALL-RESULTS] Incoming request from:', req.ip);
  console.log('📞 [CALL-RESULTS] Tenant:', req.tenant?.name || req.tenant?._id);

  try {
    const {
      uniqueid,
      leadId,
      listId,
      campaignId,
      phoneNumber,
      phoneCode,
      disposition,
      duration,
      agentId,
      userGroup,
      termReason,
      comments,
      altDial,
      calledCount,
      callDate,
      startEpoch,
      endEpoch,
      timestamp
    } = req.body;

    console.log('📞 [CALL-RESULTS] Data:', { uniqueid, campaignId, phoneNumber, disposition });

    // Validate required fields
    if (!uniqueid || !phoneNumber || !campaignId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: uniqueid, phoneNumber, campaignId'
      });
    }

    // Determine call result status
    // Valid enum values: 'answered', 'busy', 'no_answer', 'failed', 'dropped'
    let result = 'failed'; // Default for unknown dispositions

    // VICIdial disposition mapping
    if (disposition === 'SALE' || disposition === 'A') {
      result = 'answered';
    } else if (disposition === 'DNC' || disposition === 'B' || disposition === 'CB') {
      result = 'no_answer'; // DNC/Callback treated as no answer
    } else if (disposition === 'NA' || disposition === 'NO') {
      result = 'no_answer';
    } else if (disposition === 'BUSY') {
      result = 'busy';
    } else if (disposition === 'DROP' || disposition === 'AMD') {
      result = 'dropped';
    } else if (disposition === 'N' || disposition === 'NI') {
      result = 'no_answer';
    }

    // Check if we have an initial CallRecord from DID selection (from AGI script)
    let callRecord = await CallRecord.findOne({
      tenantId: req.tenant._id,
      'metadata.uniqueid': uniqueid
    }).hint({ tenantId: 1, 'metadata.uniqueid': 1 });

    if (callRecord) {
      console.log(`🔄 [CALL-RESULTS] Updating existing CallRecord ${callRecord._id} with final results`);
      console.log(`   DID: ${callRecord.didId} | Initial disposition: ${callRecord.disposition} → Final: ${disposition}`);

      // Update existing record with final call results
      callRecord.duration = duration || 0;
      callRecord.result = result;
      callRecord.disposition = disposition;
      callRecord.callTimestamp = endEpoch ? new Date(endEpoch * 1000) : callRecord.callTimestamp;

      // Merge metadata
      callRecord.metadata = {
        ...callRecord.metadata,
        leadId: leadId,
        listId: listId,
        phoneCode: phoneCode,
        agentId: agentId || callRecord.metadata?.agentId,
        userGroup: userGroup,
        termReason: termReason,
        comments: comments,
        altDial: altDial,
        calledCount: calledCount,
        callDate: callDate,
        startEpoch: startEpoch,
        endEpoch: endEpoch,
        source: 'vicidial-sync-updated'
      };

      await callRecord.save();
      console.log(`✅ [CALL-RESULTS] Updated CallRecord with DID ${callRecord.didId}`);
    } else {
      console.log(`ℹ️  [CALL-RESULTS] No initial CallRecord found - creating new one (AGI may not have been used)`);

      // Create new call record (happens when call wasn't made through our DID optimizer)
      callRecord = new CallRecord({
        tenantId: req.tenant._id,
        phoneNumber: phoneNumber,
        callTimestamp: endEpoch ? new Date(endEpoch * 1000) : new Date(),
        duration: duration || 0,
        result: result,
        disposition: disposition,
        campaignId: campaignId,
        metadata: {
          callDirection: 'outbound',
          recording: false,
          uniqueid: uniqueid,
          leadId: leadId,
          listId: listId,
          phoneCode: phoneCode,
          agentId: agentId,
          userGroup: userGroup,
          termReason: termReason,
          comments: comments,
          altDial: altDial,
          calledCount: calledCount,
          callDate: callDate,
          startEpoch: startEpoch,
          endEpoch: endEpoch,
          source: 'vicidial-sync'
        }
      });

      await callRecord.save();
    }

    // Update DID statistics if DID was tracked
    if (callRecord.didId) {
      console.log(`📊 [CALL-RESULTS] Updating DID statistics for ${callRecord.didId}`);
      // DID stats are already updated in /api/v1/dids/next endpoint
      // Could add additional outcome-based stats here if needed
    }

    // Create audit log
    await AuditLog.create({
      tenantId: req.tenant._id,
      action: 'CALL_RESULT_SYNCED',
      details: {
        uniqueid: uniqueid,
        phone: phoneNumber,
        disposition: disposition,
        duration: duration,
        campaign: campaignId,
        agent: agentId
      }
    });

    const elapsed = Date.now() - requestStart;
    console.log(`✅ [CALL-RESULTS] Success in ${elapsed}ms - Record ${callRecord._id}`);

    res.json({
      success: true,
      message: 'Call result recorded',
      data: {
        recordId: callRecord._id,
        uniqueid: uniqueid,
        disposition: disposition
      }
    });

  } catch (error) {
    const elapsed = Date.now() - requestStart;
    console.error(`💥 [CALL-RESULTS] Error after ${elapsed}ms:`, error.message);
    console.error('💥 [CALL-RESULTS] Stack:', error.stack);
    console.error('💥 [CALL-RESULTS] Request body:', JSON.stringify(req.body, null, 2));

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// API Routes
console.log('🔧 Registering API routes...');
console.log('📊 billingRoutes type:', typeof billingRoutes);
console.log('📊 billingRoutes is Router:', billingRoutes && billingRoutes.stack ? 'YES' : 'NO');
if (billingRoutes && billingRoutes.stack) {
  console.log('📊 billingRoutes has', billingRoutes.stack.length, 'routes');
}

// app.use('/api/v1/auth', authRoutes);
// app.use('/api/v1/users', userRoutes);
app.use('/api/v1/dids', didRoutes);
// app.use('/api/v1/analytics', analyticsRoutes);

// DEBUG: Log all requests to /api/v1/billing
app.use('/api/v1/billing', (req, res, next) => {
  console.log('🔍 BILLING REQUEST INTERCEPTED:', req.method, req.path, req.url);
  console.log('🔍 Full URL:', req.originalUrl);
  next();
});

console.log('🔧 Mounting billing routes at /api/v1/billing...');
app.use('/api/v1/billing', billingRoutes);
console.log('✅ Billing routes mounted!');
app.use('/api/v1/tenants', tenantRoutes);
app.use('/api/v1/settings/vicidial', vicidialRoutes);
// app.use('/api/v1/dashboard', dashboardRoutes);

// Google OAuth Configuration
const googleCallbackURL = process.env.GOOGLE_CALLBACK_URL || `${process.env.FRONTEND_URL || 'http://localhost:5000'}/api/v1/auth/google/callback`;
console.log('🔐 Configuring Google OAuth with callback URL:', googleCallbackURL);

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: googleCallbackURL,
  proxy: false  // Disable proxy detection to prevent URL override
}, async (accessToken, refreshToken, profile, done) => {
  try {
    const email = profile.emails[0].value;

    // Find or create user in database
    let user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      // Create a new tenant for the user's organization
      const orgName = `${profile.name?.givenName || profile.displayName.split(' ')[0] || ''} ${profile.name?.familyName || profile.displayName.split(' ')[1] || ''}`.trim() || email.split('@')[0];
      const emailDomain = email.split('@')[1];
      const emailUsername = email.split('@')[0];

      // Auto-generate an API key for new tenant
      const crypto = await import('crypto');
      const autoApiKey = 'did_' + crypto.randomBytes(32).toString('hex');

      // Always create unique domain to avoid conflicts (username.domain)
      const uniqueDomain = `${emailUsername}.${emailDomain}`;

      const newTenant = new Tenant({
        name: `${orgName}'s Organization`,
        domain: uniqueDomain,
        isActive: true,
        apiKeys: [{
          _id: new mongoose.Types.ObjectId(),
          name: 'Default API Key',
          key: autoApiKey,
          isActive: true,
          createdAt: new Date(),
          lastUsed: null,
          permissions: ['read', 'write']
        }],
        rotationState: {
          currentIndex: 0,
          lastReset: new Date(),
          usedDidsInCycle: []
        }
      });
      const savedTenant = await newTenant.save();
      console.log('✅ New tenant created:', savedTenant.name, 'ID:', savedTenant._id, 'with auto-generated API key');

      // Create new user with tenant
      user = new User({
        email: email.toLowerCase(),
        firstName: profile.name?.givenName || profile.displayName.split(' ')[0] || '',
        lastName: profile.name?.familyName || profile.displayName.split(' ')[1] || '',
        role: 'CLIENT', // Default role for Google OAuth users
        tenant: savedTenant._id, // Assign the saved tenant ID
        isActive: true,
        isEmailVerified: true, // Email verified by Google
        googleId: profile.id,
        avatar: profile.photos[0]?.value,
        lastLogin: new Date()
      });
      console.log('🔍 Creating user with tenant ID:', savedTenant._id);
      await user.save();
      console.log('✅ New user created via Google OAuth:', email);
    } else {
      // Update existing user
      user.googleId = profile.id;
      user.avatar = profile.photos[0]?.value;
      user.lastLogin = new Date();
      await user.save();
      console.log('✅ Existing user logged in via Google OAuth:', email);
    }

    return done(null, user);
  } catch (error) {
    console.error('❌ Google OAuth error:', error);
    console.error('❌ Error stack:', error.stack);
    console.error('❌ Error details:', JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
    console.error('❌ Error name:', error.name);
    console.error('❌ Error message:', error.message);
    if (error.code) console.error('❌ Error code:', error.code);
    return done(error, null);
  }
}));

passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((user, done) => {
  done(null, user);
});

// Google OAuth Routes
app.get('/api/v1/auth/google', (req, res, next) => {
  console.log('🔵 Google OAuth initiated');
  console.log('🔵 Request URL:', req.url);
  console.log('🔵 Request headers:', JSON.stringify(req.headers, null, 2));
  next();
}, passport.authenticate('google', { scope: ['profile', 'email'] }));

app.get('/api/v1/auth/google/callback', (req, res, next) => {
  console.log('🟢 Google OAuth callback received');
  console.log('🟢 Callback URL:', req.url);
  console.log('🟢 Query params:', JSON.stringify(req.query, null, 2));
  next();
}, passport.authenticate('google', {
  failureRedirect: `${process.env.FRONTEND_URL || 'http://localhost:5000'}/login?error=auth_failed`,
  failureMessage: true
}), (req, res) => {
    try {
      console.log('🟢 Passport authentication succeeded');
      console.log('🟢 User in request:', req.user ? 'YES' : 'NO');

      // Check if user exists
      if (!req.user) {
        console.error('❌ OAuth callback: No user in request');
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5000';
        return res.redirect(`${frontendUrl}/login?error=user_not_found`);
      }

      // Successful authentication
      // Generate JWT access token for the user with database ID
      const accessToken = jsonwebtoken.sign(
        {
          id: req.user._id.toString(),
          email: req.user.email,
          firstName: req.user.firstName,
          lastName: req.user.lastName,
          role: req.user.role
        },
        process.env.JWT_SECRET || 'default-secret',
        { expiresIn: '7d' }
      );

      // Generate refresh token (longer expiration)
      const refreshToken = jsonwebtoken.sign(
        {
          id: req.user._id.toString(),
          type: 'refresh'
        },
        process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET || 'default-refresh-secret',
        { expiresIn: '30d' }
      );

      console.log('🔐 Google OAuth tokens generated for user:', req.user.email);

      // Redirect to configured frontend URL
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5000';
      console.log('🔗 Redirecting to:', `${frontendUrl}/auth/callback`);

      // Redirect to frontend with both tokens in URL (will be stored by frontend)
      res.redirect(`${frontendUrl}/auth/callback?token=${accessToken}&refresh=${refreshToken}`);
    } catch (error) {
      console.error('❌ OAuth callback error:', error);
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5000';
      res.redirect(`${frontendUrl}/login?error=callback_failed`);
    }
  }
);

app.get('/api/v1/auth/logout', (req, res) => {
  req.logout((err) => {
    if (err) { return res.status(500).json({ error: 'Logout failed' }); }

    // Redirect to configured frontend URL
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5000';
    res.redirect(frontendUrl);
  });
});

// Basic Auth Routes
app.post('/api/v1/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    if (!user.isActive) {
      return res.status(401).json({ message: 'Account is deactivated' });
    }

    // Check password using bcrypt (assuming password is hashed)
    const bcrypt = await import('bcryptjs');
    const isValidPassword = await bcrypt.compare(password, user.password);

    if (!isValidPassword) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // Generate JWT token
    const token = jsonwebtoken.sign(
      {
        id: user._id.toString(),
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role
      },
      process.env.JWT_SECRET || 'default-secret',
      { expiresIn: '7d' }
    );

    res.json({
      data: {
        message: 'Login successful',
        tokens: {
          accessToken: token,
          refreshToken: token // For now, using same token for both
        },
        user: {
          id: user._id.toString(),
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          tenant: user.tenant
        }
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Registration endpoint
app.post('/api/v1/auth/register', async (req, res) => {
  try {
    const { firstName, lastName, email, password } = req.body;

    // Validate input
    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters long' });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ message: 'Email already registered' });
    }

    // Create a new tenant for the user's organization
    const emailDomain = email.split('@')[1];
    const emailUsername = email.split('@')[0];

    // Auto-generate an API key for new tenant
    const crypto = await import('crypto');
    const autoApiKey = 'did_' + crypto.randomBytes(32).toString('hex');

    // Always create unique domain to avoid conflicts (username.domain)
    const uniqueDomain = `${emailUsername}.${emailDomain}`;

    const newTenant = new Tenant({
      name: `${firstName} ${lastName}'s Organization`,
      domain: uniqueDomain,
      subdomain: `${firstName.toLowerCase()}-${Date.now()}`,
      isActive: true,
      apiKeys: [{
        _id: new mongoose.Types.ObjectId(),
        name: 'Default API Key',
        key: autoApiKey,
        isActive: true,
        createdAt: new Date(),
        lastUsed: null,
        permissions: ['read', 'write']
      }],
      subscription: {
        plan: 'basic',
        status: 'trial',
        billingCycle: 'monthly'
      },
      rotationState: {
        currentIndex: 0,
        lastReset: new Date(),
        usedDidsInCycle: []
      }
    });
    const savedTenant = await newTenant.save();
    console.log('✅ New tenant created via registration:', savedTenant.name, 'with auto-generated API key');

    // Generate email verification token
    const emailVerificationToken = crypto.randomBytes(32).toString('hex');

    // Create new user
    const newUser = new User({
      email: email.toLowerCase(),
      firstName,
      lastName,
      password, // Will be hashed by the pre-save middleware
      role: 'CLIENT',
      tenant: savedTenant._id,
      isActive: true,
      isEmailVerified: false, // Email verification required
      emailVerificationToken,
      lastLogin: new Date()
    });
    await newUser.save();
    console.log('✅ New user registered:', email);

    // Send verification email
    const frontendUrl = process.env.FRONTEND_URL || 'https://dids.amdy.io';
    const verificationUrl = `${frontendUrl}/verify-email?token=${emailVerificationToken}`;

    try {
      await resend.emails.send({
        from: process.env.FROM_EMAIL || 'DID Optimizer <noreply@amdy.io>',
        to: email,
        subject: 'Verify your DID Optimizer account',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Welcome to DID Optimizer, ${firstName}!</h2>
            <p>Thank you for registering. Please verify your email address by clicking the button below:</p>
            <a href="${verificationUrl}" style="display: inline-block; background-color: #4052B5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; margin: 20px 0;">
              Verify Email Address
            </a>
            <p>Or copy and paste this link into your browser:</p>
            <p style="color: #666; word-break: break-all;">${verificationUrl}</p>
            <p style="color: #999; font-size: 12px; margin-top: 40px;">
              If you didn't create an account, you can safely ignore this email.
            </p>
          </div>
        `
      });
      console.log('✅ Verification email sent to:', email);
    } catch (emailError) {
      console.error('❌ Failed to send verification email:', emailError);
      // Don't fail registration if email fails
    }

    // Generate JWT tokens
    const accessToken = jsonwebtoken.sign(
      {
        id: newUser._id.toString(),
        email: newUser.email,
        firstName: newUser.firstName,
        lastName: newUser.lastName,
        role: newUser.role
      },
      process.env.JWT_SECRET || 'default-secret',
      { expiresIn: '7d' }
    );

    const refreshToken = jsonwebtoken.sign(
      {
        id: newUser._id.toString(),
        type: 'refresh'
      },
      process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET || 'default-refresh-secret',
      { expiresIn: '30d' }
    );

    res.status(201).json({
      data: {
        message: 'Registration successful',
        tokens: {
          accessToken,
          refreshToken
        },
        user: {
          id: newUser._id.toString(),
          email: newUser.email,
          firstName: newUser.firstName,
          lastName: newUser.lastName,
          role: newUser.role,
          tenant: savedTenant._id
        },
        tenant: {
          id: savedTenant._id.toString(),
          name: savedTenant.name,
          domain: savedTenant.domain
        }
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Email verification endpoint
app.post('/api/v1/auth/verify-email', async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ message: 'Verification token is required' });
    }

    // Find user by verification token
    const user = await User.findOne({ emailVerificationToken: token });

    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired verification token' });
    }

    // Mark email as verified
    user.isEmailVerified = true;
    user.emailVerificationToken = null; // Clear the token
    await user.save();

    console.log('✅ Email verified for user:', user.email);

    res.json({
      data: {
        message: 'Email verified successfully',
        user: {
          id: user._id.toString(),
          email: user.email,
          isEmailVerified: true
        }
      }
    });
  } catch (error) {
    console.error('Email verification error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Forgot password endpoint
app.post('/api/v1/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    // Find user by email
    const user = await User.findOne({ email: email.toLowerCase() });

    // Always return success to prevent email enumeration attacks
    if (!user) {
      console.log('⚠️ Password reset requested for non-existent email:', email);
      return res.json({
        data: {
          message: 'If an account exists with this email, you will receive a password reset link.'
        }
      });
    }

    // Generate password reset token (valid for 1 hour)
    const resetToken = crypto.randomBytes(32).toString('hex');
    user.passwordResetToken = resetToken;
    user.passwordResetExpires = new Date(Date.now() + 3600000); // 1 hour
    await user.save();

    console.log('✅ Password reset token generated for:', email);

    // Send password reset email
    const frontendUrl = process.env.FRONTEND_URL || 'https://dids.amdy.io';
    const resetUrl = `${frontendUrl}/reset-password?token=${resetToken}`;

    try {
      await resend.emails.send({
        from: process.env.FROM_EMAIL || 'DID Optimizer <noreply@amdy.io>',
        to: email,
        subject: 'Reset your DID Optimizer password',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Password Reset Request</h2>
            <p>Hi ${user.firstName},</p>
            <p>We received a request to reset your password for your DID Optimizer account.</p>
            <p>Click the button below to reset your password:</p>
            <a href="${resetUrl}" style="display: inline-block; background-color: #4052B5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; margin: 20px 0;">
              Reset Password
            </a>
            <p>Or copy and paste this link into your browser:</p>
            <p style="color: #666; word-break: break-all;">${resetUrl}</p>
            <p style="color: #999; font-size: 14px; margin-top: 30px;">
              This link will expire in 1 hour for security reasons.
            </p>
            <p style="color: #999; font-size: 12px; margin-top: 20px;">
              If you didn't request a password reset, you can safely ignore this email.
            </p>
          </div>
        `
      });
      console.log('✅ Password reset email sent to:', email);
    } catch (emailError) {
      console.error('❌ Failed to send password reset email:', emailError);
      // Still return success to user
    }

    res.json({
      data: {
        message: 'If an account exists with this email, you will receive a password reset link.'
      }
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Reset password endpoint
app.post('/api/v1/auth/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({ message: 'Token and new password are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters long' });
    }

    // Find user by reset token and check expiration
    const user = await User.findOne({
      passwordResetToken: token,
      passwordResetExpires: { $gt: new Date() }
    });

    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired password reset token' });
    }

    // Update password (will be hashed by pre-save middleware)
    user.password = password;
    user.passwordResetToken = null;
    user.passwordResetExpires = null;
    await user.save();

    console.log('✅ Password reset successful for:', user.email);

    // Send confirmation email
    try {
      await resend.emails.send({
        from: process.env.FROM_EMAIL || 'DID Optimizer <noreply@amdy.io>',
        to: user.email,
        subject: 'Your DID Optimizer password has been changed',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Password Changed Successfully</h2>
            <p>Hi ${user.firstName},</p>
            <p>Your DID Optimizer password has been successfully changed.</p>
            <p>If you didn't make this change, please contact our support team immediately.</p>
            <p style="color: #999; font-size: 12px; margin-top: 40px;">
              This is an automated security notification.
            </p>
          </div>
        `
      });
      console.log('✅ Password change confirmation email sent');
    } catch (emailError) {
      console.error('❌ Failed to send confirmation email:', emailError);
    }

    res.json({
      data: {
        message: 'Password reset successful. You can now login with your new password.'
      }
    });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Get current user endpoint
app.get('/api/v1/auth/me', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }

    const decoded = jsonwebtoken.verify(token, process.env.JWT_SECRET || 'default-secret');
    const user = await User.findById(decoded.id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({
      data: {
        user: {
          id: user._id.toString(),
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          tenant: user.tenant
        }
      }
    });
  } catch (error) {
    console.error('Auth me error:', error);
    res.status(401).json({ message: 'Invalid token' });
  }
});

// Dashboard API Endpoints
app.get('/api/v1/dashboard/stats', async (req, res) => {
  console.log('🔍 Dashboard stats endpoint called');
  try {
    // Get user from JWT token OR session
    const token = req.headers.authorization?.replace('Bearer ', '');
    let userTenantId = null;
    let isAdmin = false;

    // Try JWT auth first
    if (token) {
      try {
        const decoded = jsonwebtoken.verify(token, process.env.JWT_SECRET || 'default-secret');
        const user = await User.findById(decoded.id);
        if (user) {
          userTenantId = user.tenant || user.tenantId;
          isAdmin = user.role === 'ADMIN' || user.role === 'SUPER_ADMIN';
          console.log('👤 JWT User:', user.email, 'Tenant:', userTenantId);
        }
      } catch (error) {
        console.error('Token decode error:', error.message);
      }
    }

    // If no JWT, try session auth
    if (!userTenantId && req.session?.user) {
      userTenantId = req.session.user.tenantId || req.session.user.tenant;
      isAdmin = req.session.user.role === 'ADMIN' || req.session.user.role === 'SUPER_ADMIN';
      console.log('👤 Session User:', req.session.user.email, 'Tenant:', userTenantId);
    }

    // If no JWT, try passport user
    if (!userTenantId && req.user) {
      userTenantId = req.user.tenant || req.user.tenantId;
      isAdmin = req.user.role === 'ADMIN' || req.user.role === 'SUPER_ADMIN';
      console.log('👤 Passport User:', req.user.email, 'Tenant:', userTenantId);
    }

    // If still no tenant found and not admin, return error
    if (!userTenantId && !isAdmin) {
      console.log('❌ No authentication found - returning 401');
      return res.status(401).json({ success: false, message: 'Access token required' });
    }

    // Get actual data from database (only count for this tenant, not system-wide)
    const totalUsers = isAdmin ? await User.countDocuments() : 1;
    const totalTenants = isAdmin ? await User.distinct('tenant').then(tenants => tenants.filter(Boolean).length) : 1;

    // Build DID query based on user role
    // Convert tenant ID to ObjectId for proper MongoDB comparison
    const didQuery = userTenantId && !isAdmin ? {
      tenantId: mongoose.Types.ObjectId.isValid(userTenantId) ?
        new mongoose.Types.ObjectId(userTenantId) : userTenantId
    } : {};
    console.log('📊 DID Query filter:', didQuery);

    // Get DID statistics from real database
    const totalDIDs = await DID.countDocuments(didQuery);
    const activeDIDs = await DID.countDocuments({ ...didQuery, status: 'active' });

    // Get today's calls (filter by tenant for non-admin users)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const callQuery = userTenantId && !isAdmin ? { tenantId: userTenantId.toString() } : {};
    const callsToday = await CallRecord.countDocuments({
      ...callQuery,
      callTimestamp: { $gte: today }
    });

    // API calls are the total number of DID requests made today
    const apiCalls = callsToday;
    // API Usage is total API calls made by this tenant
    const apiUsage = callsToday;

    // Calculate success rate from actual call records
    const totalCallsToday = await CallRecord.countDocuments({
      ...callQuery,
      callTimestamp: { $gte: today }
    });
    const successfulCalls = await CallRecord.countDocuments({
      ...callQuery,
      callTimestamp: { $gte: today },
      result: 'answered'
    });
    const successRate = totalCallsToday > 0
      ? `${((successfulCalls / totalCallsToday) * 100).toFixed(1)}%`
      : '0%';

    // Real system health checks
    let systemHealth = 'healthy';
    let dbStatus = 'online';
    let dbLatency = 0;

    try {
      const dbStartTime = Date.now();
      await mongoose.connection.db.admin().ping();
      dbLatency = Date.now() - dbStartTime;
      dbStatus = 'online';
    } catch (error) {
      console.error('Database health check failed:', error);
      dbStatus = 'offline';
      systemHealth = 'error';
    }

    // Calculate active sessions (unique API keys in last 5 minutes)
    const fiveMinutesAgo = new Date(Date.now() - 300000);
    const activeSessions = await CallRecord.distinct('metadata.apiKey', {
      callTimestamp: { $gte: fiveMinutesAgo }
    }).then(keys => keys.filter(Boolean).length);

    // Calculate performance metrics
    // Get recent call records with metadata to calculate average query time
    const recentCalls = await CallRecord.find({
      ...callQuery,
      callTimestamp: { $gte: today },
      'metadata.responseTime': { $exists: true }
    })
      .select('metadata.responseTime metadata.endpoint')
      .limit(1000)
      .lean();

    // Calculate average query time for DID endpoint
    const didCalls = recentCalls.filter(call =>
      call.metadata?.endpoint === '/api/v1/dids/next' || !call.metadata?.endpoint
    );
    let didQueryTime = 0;
    if (didCalls.length > 0) {
      const totalTime = didCalls.reduce((sum, call) => {
        return sum + (call.metadata?.responseTime || 0);
      }, 0);
      didQueryTime = Math.round(totalTime / didCalls.length * 100) / 100;
    }

    // Calculate average query time for Results endpoint
    const resultCalls = recentCalls.filter(call =>
      call.metadata?.endpoint === '/api/v1/call-results'
    );
    let resultsQueryTime = 0;
    if (resultCalls.length > 0) {
      const totalTime = resultCalls.reduce((sum, call) => {
        return sum + (call.metadata?.responseTime || 0);
      }, 0);
      resultsQueryTime = Math.round(totalTime / resultCalls.length * 100) / 100;
    }

    // Overall average query time (for backward compatibility)
    let avgQueryTime = 0;
    if (recentCalls.length > 0) {
      const totalTime = recentCalls.reduce((sum, call) => {
        return sum + (call.metadata?.responseTime || 0);
      }, 0);
      avgQueryTime = Math.round(totalTime / recentCalls.length * 100) / 100;
    }

    // Calculate requests per second (RPS)
    // Get calls from the last 60 seconds for real-time RPS
    const sixtySecondsAgo = new Date(Date.now() - 60000);
    const callsLastMinute = await CallRecord.countDocuments({
      ...callQuery,
      callTimestamp: { $gte: sixtySecondsAgo }
    });
    const requestsPerSecond = Math.round((callsLastMinute / 60) * 100) / 100;

    // Get tenant list for admin users
    let tenantList = [];
    if (isAdmin) {
      const tenants = await mongoose.connection.db.collection('tenants').find({}).toArray();
      tenantList = tenants.map(t => ({
        _id: t._id,
        name: t.name || 'Unnamed',
        status: t.status || 'active',
        subscription: t.subscription?.plan || 'free'
      }));
    }

    // Get recent activity from audit logs
    const recentActivity = await AuditLog.find({})
      .sort({ timestamp: -1 })
      .limit(3)
      .select('action resourceId timestamp')
      .lean();

    // Format recent activity for frontend
    const formattedActivity = recentActivity.map((activity, index) => ({
      id: index + 1,
      action: activity.action || 'System Action',
      did: activity.resourceId || 'N/A',
      time: activity.timestamp ?
        `${Math.floor((Date.now() - activity.timestamp.getTime()) / 60000)} minutes ago` :
        'Recently'
    }));

    // Fallback if no activities found
    const finalActivity = formattedActivity.length > 0 ? formattedActivity : [
      { id: 1, action: 'System Started', did: 'N/A', time: 'Recently' }
    ];

    console.log('✅ Dashboard stats response ready');
    console.log('📊 Performance metrics:', { avgQueryTime, didQueryTime, resultsQueryTime, requestsPerSecond, activeSessions });
    res.json({
      data: {
        // Admin view fields - using real data
        totalUsers,
        totalTenants,
        totalDIDs,
        apiCalls,

        // Regular user view fields
        activeDIDs,
        callsToday,
        successRate,
        apiUsage,
        systemHealth,

        // System health details
        dbStatus,
        dbLatency,

        // Performance metrics
        avgQueryTime,
        didQueryTime,
        resultsQueryTime,
        requestsPerSecond,
        activeSessions,

        // Tenant list (admin only)
        tenantList,

        recentActivity: finalActivity
      }
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({ message: 'Failed to load dashboard stats' });
  }
});

// Admin: Get all tenants with metrics
app.get('/api/v1/admin/tenants', async (req, res) => {
  try {
    // Get user from token
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const decoded = jsonwebtoken.verify(token, process.env.JWT_SECRET || 'default-secret');
    const user = await User.findById(decoded.id);

    if (!user || (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN')) {
      return res.status(403).json({ message: 'Admin access required' });
    }

    // Get all tenants from the database
    const tenants = await mongoose.connection.db.collection('tenants').find({}).toArray();

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get metrics for each tenant
    const tenantsWithMetrics = await Promise.all(tenants.map(async (tenant) => {
      const tenantId = tenant._id;

      // Count users for this tenant
      const userCount = await User.countDocuments({ tenant: tenantId.toString() });

      // Count DIDs for this tenant
      const didCount = await DID.countDocuments({ tenantId });

      // Count calls today for this tenant
      const callsToday = await CallRecord.countDocuments({
        tenantId: tenantId.toString(),
        callTimestamp: { $gte: today }
      });

      return {
        _id: tenant._id,
        name: tenant.name || 'Unnamed Tenant',
        subdomain: tenant.subdomain || '',
        status: tenant.status || 'active',
        subscription: tenant.subscription?.plan || 'free',
        users: userCount,
        dids: didCount,
        callsToday: callsToday,
        createdAt: tenant.createdAt
      };
    }));

    res.json({
      success: true,
      tenants: tenantsWithMetrics
    });
  } catch (error) {
    console.error('Admin tenants error:', error);
    res.status(500).json({ message: 'Failed to load tenants' });
  }
});

// System Health - Detailed monitoring page
app.get('/api/v1/system-health', async (req, res) => {
  try {
    // Get user from token
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const decoded = jsonwebtoken.verify(token, process.env.JWT_SECRET || 'default-secret');
    const user = await User.findById(decoded.id);

    if (!user || (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN')) {
      return res.status(403).json({ message: 'Admin access required' });
    }

    console.log('📊 Fetching detailed system health metrics...');

    // Database Health Check
    let dbHealth = {
      status: 'healthy',
      latency: 0,
      connections: 0,
      collections: 0,
      error: null
    };

    try {
      const dbStart = Date.now();
      await mongoose.connection.db.admin().ping();
      dbHealth.latency = Date.now() - dbStart;
      dbHealth.status = 'healthy';

      // Get connection stats
      const serverStatus = await mongoose.connection.db.admin().serverStatus();
      dbHealth.connections = serverStatus.connections?.current || 0;

      // Get collections count
      const collections = await mongoose.connection.db.listCollections().toArray();
      dbHealth.collections = collections.length;
    } catch (error) {
      console.error('Database health check failed:', error);
      dbHealth.status = 'error';
      dbHealth.error = error.message;
    }

    // Time ranges for queries
    const now = new Date();
    const last5Min = new Date(now - 5 * 60 * 1000);
    const last1Hour = new Date(now - 60 * 60 * 1000);
    const last24Hours = new Date(now - 24 * 60 * 60 * 1000);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get all tenants
    const tenants = await mongoose.connection.db.collection('tenants').find({}).toArray();

    // Per-tenant metrics with query breakdown
    const tenantMetrics = await Promise.all(tenants.map(async (tenant) => {
      const tenantId = tenant._id.toString();

      // Get call records for this tenant
      const calls24h = await CallRecord.countDocuments({
        tenantId,
        callTimestamp: { $gte: last24Hours }
      });

      const calls1h = await CallRecord.countDocuments({
        tenantId,
        callTimestamp: { $gte: last1Hour }
      });

      const calls5m = await CallRecord.countDocuments({
        tenantId,
        callTimestamp: { $gte: last5Min }
      });

      // Get DID queries (endpoint: /api/v1/dids/next)
      const didQueries24h = await CallRecord.countDocuments({
        tenantId,
        callTimestamp: { $gte: last24Hours },
        $or: [
          { 'metadata.endpoint': '/api/v1/dids/next' },
          { 'metadata.endpoint': { $exists: false } }
        ]
      });

      const didQueries1h = await CallRecord.countDocuments({
        tenantId,
        callTimestamp: { $gte: last1Hour },
        $or: [
          { 'metadata.endpoint': '/api/v1/dids/next' },
          { 'metadata.endpoint': { $exists: false } }
        ]
      });

      // Get Results queries (endpoint: /api/v1/call-results)
      const resultQueries24h = await CallRecord.countDocuments({
        tenantId,
        callTimestamp: { $gte: last24Hours },
        'metadata.endpoint': '/api/v1/call-results'
      });

      const resultQueries1h = await CallRecord.countDocuments({
        tenantId,
        callTimestamp: { $gte: last1Hour },
        'metadata.endpoint': '/api/v1/call-results'
      });

      // Average query times for this tenant
      const recentCalls = await CallRecord.find({
        tenantId,
        callTimestamp: { $gte: last1Hour },
        'metadata.responseTime': { $exists: true }
      }).limit(1000).lean();

      const didCalls = recentCalls.filter(call =>
        call.metadata?.endpoint === '/api/v1/dids/next' || !call.metadata?.endpoint
      );
      const resultCalls = recentCalls.filter(call =>
        call.metadata?.endpoint === '/api/v1/call-results'
      );

      const avgDidQueryTime = didCalls.length > 0
        ? didCalls.reduce((sum, call) => sum + (call.metadata?.responseTime || 0), 0) / didCalls.length
        : 0;

      const avgResultQueryTime = resultCalls.length > 0
        ? resultCalls.reduce((sum, call) => sum + (call.metadata?.responseTime || 0), 0) / resultCalls.length
        : 0;

      // Get active DIDs for this tenant
      const activeDIDs = await DID.countDocuments({
        tenantId: tenant._id,
        status: 'active'
      });

      // Get users for this tenant
      const userCount = await User.countDocuments({ tenant: tenantId });

      return {
        tenantId,
        name: tenant.name || 'Unnamed Tenant',
        subscription: tenant.subscription?.plan || 'free',
        status: tenant.status || 'active',
        users: userCount,
        activeDIDs,
        queries: {
          last5min: calls5m,
          last1hour: calls1h,
          last24hours: calls24h,
          didQueries24h,
          didQueries1h,
          resultQueries24h,
          resultQueries1h
        },
        performance: {
          avgDidQueryTime: Math.round(avgDidQueryTime * 100) / 100,
          avgResultQueryTime: Math.round(avgResultQueryTime * 100) / 100
        }
      };
    }));

    // System-wide metrics
    const totalQueries24h = await CallRecord.countDocuments({
      callTimestamp: { $gte: last24Hours }
    });

    const totalQueries1h = await CallRecord.countDocuments({
      callTimestamp: { $gte: last1Hour }
    });

    const totalQueries5m = await CallRecord.countDocuments({
      callTimestamp: { $gte: last5Min }
    });

    // Active sessions (unique API keys in last 5 minutes)
    const activeSessions = await CallRecord.distinct('metadata.apiKey', {
      callTimestamp: { $gte: last5Min }
    }).then(keys => keys.filter(Boolean).length);

    // Total active DIDs
    const totalActiveDIDs = await DID.countDocuments({ status: 'active' });

    // Total users
    const totalUsers = await User.countDocuments();

    // Requests per second (based on last 5 minutes)
    const requestsPerSecond = totalQueries5m / 300; // 300 seconds in 5 minutes

    // Overall average query times
    const recentAllCalls = await CallRecord.find({
      callTimestamp: { $gte: last1Hour },
      'metadata.responseTime': { $exists: true }
    }).limit(5000).lean();

    const allDidCalls = recentAllCalls.filter(call =>
      call.metadata?.endpoint === '/api/v1/dids/next' || !call.metadata?.endpoint
    );
    const allResultCalls = recentAllCalls.filter(call =>
      call.metadata?.endpoint === '/api/v1/call-results'
    );

    const systemAvgDidQueryTime = allDidCalls.length > 0
      ? allDidCalls.reduce((sum, call) => sum + (call.metadata?.responseTime || 0), 0) / allDidCalls.length
      : 0;

    const systemAvgResultQueryTime = allResultCalls.length > 0
      ? allResultCalls.reduce((sum, call) => sum + (call.metadata?.responseTime || 0), 0) / allResultCalls.length
      : 0;

    console.log('✅ System health metrics collected');

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      database: dbHealth,
      system: {
        activeSessions,
        totalUsers,
        totalTenants: tenants.length,
        totalActiveDIDs,
        queries: {
          last5min: totalQueries5m,
          last1hour: totalQueries1h,
          last24hours: totalQueries24h
        },
        performance: {
          requestsPerSecond: Math.round(requestsPerSecond * 100) / 100,
          avgDidQueryTime: Math.round(systemAvgDidQueryTime * 100) / 100,
          avgResultQueryTime: Math.round(systemAvgResultQueryTime * 100) / 100
        }
      },
      tenants: tenantMetrics
    });
  } catch (error) {
    console.error('System health error:', error);
    res.status(500).json({ message: 'Failed to load system health data' });
  }
});

// DID Management API Endpoints
app.get('/api/v1/dids', async (req, res) => {
  try {
    // Get user's tenant from JWT token
    const token = req.headers.authorization?.replace('Bearer ', '');
    let userTenantId = null;
    let isAdmin = false;

    if (token) {
      try {
        const decoded = jsonwebtoken.verify(token, process.env.JWT_SECRET || 'default-secret');
        const user = await User.findById(decoded.id);
        if (user) {
          userTenantId = user.tenant || user.tenantId;
          isAdmin = user.role === 'ADMIN' || user.role === 'SUPER_ADMIN';
        }
      } catch (error) {
        console.error('Token decode error in DID list:', error.message);
      }
    }

    // Parse pagination parameters
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 25;
    const skip = (page - 1) * limit;
    const sortBy = req.query.sortBy || 'createdAt';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
    const search = req.query.search || '';

    // Build query - FILTER BY TENANT unless admin
    let query = {};
    if (!isAdmin && userTenantId) {
      query.tenantId = userTenantId;
    }
    if (search) {
      query.phoneNumber = { $regex: search, $options: 'i' };
    }

    // Get total count for pagination
    const totalCount = await DID.countDocuments(query);

    // Get DIDs with pagination and proper sorting
    let sortObj = {};

    // Handle nested field sorting
    if (sortBy === 'usage.lastUsed') {
      sortObj = { 'usage.lastUsed': sortOrder };
    } else if (sortBy === 'reputation.score') {
      sortObj = { 'reputation.score': sortOrder };
    } else if (sortBy === 'phoneNumber') {
      sortObj = { phoneNumber: sortOrder };
    } else if (sortBy === 'status') {
      sortObj = { status: sortOrder };
    } else {
      sortObj = { [sortBy]: sortOrder };
    }

    const dids = await DID.find(query)
      .sort(sortObj)
      .skip(skip)
      .limit(limit)
      .lean();

    // Format DIDs for frontend with call statistics and real location data
    const formattedDids = await Promise.all(dids.map(async (did, index) => {
      // Get call count for this DID
      const callCount = await CallRecord.countDocuments({ didId: did._id.toString() });

      // Use actual reputation score or 0 (no mock data)
      const performance = did.reputation && did.reputation.score ?
        did.reputation.score : 0;

      // Extract area code and get location data
      const areaCode = did.phoneNumber ? did.phoneNumber.substring(2, 5) : '';
      const locationData = await getLocationByAreaCode(areaCode);

      return {
        id: skip + index + 1,
        _id: did._id.toString(), // Include MongoDB ID for cross-page selection
        number: did.phoneNumber || '',
        status: did.status || 'unknown',
        calls: callCount,
        performance: Math.round(performance * 10) / 10,
        usage: {
          lastUsed: did.usage?.lastUsed ? did.usage.lastUsed.toISOString() : null,
          totalCalls: did.usage?.totalCalls || 0,
          lastCampaign: did.usage?.lastCampaign || null,
          lastAgent: did.usage?.lastAgent || null
        },
        reputation: {
          score: did.reputation?.score || 0,
          callVolume: did.reputation?.callVolume || 0,
          successRate: did.reputation?.successRate || 0,
          status: did.reputation?.status || 'Unknown',
          lastChecked: did.reputation?.lastChecked || null
        },
        location: {
          state: locationData.state || 'Unknown',
          city: locationData.city || 'Unknown',
          areaCode: areaCode
        },
        tenantId: did.tenantId,
        createdAt: did.createdAt,
        updatedAt: did.updatedAt
      };
    }));

    const totalPages = Math.ceil(totalCount / limit);

    res.json({
      data: formattedDids,
      pagination: {
        current: page,
        total: totalCount,
        pages: totalPages,
        limit: limit
      }
    });
  } catch (error) {
    console.error('DID list error:', error);
    res.status(500).json({ message: 'Failed to load DIDs' });
  }
});

// DID Details endpoint for individual DID information
app.get('/api/v1/dids/:id', async (req, res) => {
  try {
    const did = await DID.findById(req.params.id).lean();

    if (!did) {
      return res.status(404).json({ message: 'DID not found' });
    }

    // Get call statistics
    const callCount = await CallRecord.countDocuments({ didId: did._id.toString() });
    const connectedCalls = await CallRecord.countDocuments({
      didId: did._id.toString(),
      status: 'connected'
    });

    // Get location data
    const areaCode = did.phoneNumber ? did.phoneNumber.substring(2, 5) : '';
    const locationData = await getLocationByAreaCode(areaCode);

    // Format detailed DID response
    const response = {
      id: did._id,
      phoneNumber: did.phoneNumber,
      status: did.status || 'active',
      capacity: did.capacity || 'unlimited',
      createdAt: did.createdAt,

      reputation: {
        score: did.reputation?.score || 0,
        status: did.reputation?.status || 'Unknown',
        lastChecked: did.reputation?.lastChecked || 'Never',
        userReports: did.reputation?.robokillerData?.userReports || 0,
        robokillerStatus: did.reputation?.robokillerData?.robokillerStatus || 'Unknown'
      },

      usage: {
        totalCalls: callCount,
        connectedCalls: connectedCalls,
        lastUsed: did.lastUsed || 'Never'
      },

      location: {
        state: locationData.state || 'Unknown',
        city: locationData.city || 'Unknown',
        areaCode: areaCode,
        country: locationData.country || 'US'
      }
    };

    res.json(response);
  } catch (error) {
    console.error('DID details error:', error);
    res.status(500).json({ message: 'Failed to load DID details' });
  }
});

// Export DIDs to CSV
app.get('/api/v1/dids/export', async (req, res) => {
  try {
    logger.info('📤 Export DIDs endpoint called');

    // Get user's tenant from JWT token or session
    let tenantId = req.session?.user?.tenantId || req.user?.tenantId;

    // Try to get from JWT if not in session
    if (!tenantId) {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (token) {
        try {
          const decoded = jsonwebtoken.verify(token, process.env.JWT_SECRET || 'default-secret');
          const user = await User.findById(decoded.id);
          if (user) {
            tenantId = user.tenant || user.tenantId;
          }
        } catch (error) {
          console.error('Token decode error in export:', error.message);
        }
      }
    }

    if (!tenantId) {
      return res.status(401).json({ message: 'Unauthorized - no tenant ID' });
    }

    // Fetch all DIDs for the tenant
    const dids = await DID.find({ tenantId }).sort({ createdAt: -1 }).lean();

    logger.info(`📊 Exporting ${dids.length} DIDs for tenant ${tenantId}`);

    // Generate CSV
    const csvRows = [];

    // CSV Header
    csvRows.push([
      'Phone Number',
      'Status',
      'Capacity',
      'State',
      'Area Code',
      'NPANXX',
      'Reputation Score',
      'Total Calls',
      'Today Usage',
      'Last Used',
      'Created At'
    ].join(','));

    // CSV Data rows
    for (const did of dids) {
      const areaCode = did.phoneNumber ? did.phoneNumber.substring(2, 5) : '';
      const npanxx = did.npanxx || (did.phoneNumber ? did.phoneNumber.substring(2, 8) : '');

      // Calculate today's usage
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayUsage = did.usage?.dailyUsage?.find(d => {
        const usageDate = new Date(d.date);
        usageDate.setHours(0, 0, 0, 0);
        return usageDate.getTime() === today.getTime();
      });

      const row = [
        `"${did.phoneNumber || ''}"`,
        did.status || 'active',
        did.capacity || process.env.DEFAULT_DID_CAPACITY || '100',
        did.state || '',
        areaCode,
        npanxx,
        did.reputation?.score || 0,
        did.usage?.totalCalls || 0,
        todayUsage?.count || 0,
        did.usage?.lastUsed ? new Date(did.usage.lastUsed).toISOString() : 'Never',
        did.createdAt ? new Date(did.createdAt).toISOString() : ''
      ].join(',');

      csvRows.push(row);
    }

    const csv = csvRows.join('\n');
    const filename = `dids_export_${new Date().toISOString().split('T')[0]}.csv`;

    // Set headers for CSV download
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);

    logger.info(`✅ CSV export completed: ${filename}`);
  } catch (error) {
    logger.error('❌ Export DIDs error:', error);
    res.status(500).json({ message: 'Failed to export DIDs', error: error.message });
  }
});

// Test endpoint for debugging
app.get('/api/v1/test-logging', (req, res) => {
  console.log('🧪 Test logging endpoint called!');
  res.json({ success: true, message: 'Logging test successful' });
});

// VICIdial Configuration Generator
app.get('/api/v1/vicidial/config', async (req, res) => {
  try {
    console.log('🔧 VICIdial config generation endpoint called');

    // Get user from session or token
    let userId = null;
    let userTenantId = null;

    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token) {
      try {
        const decoded = jsonwebtoken.verify(token, process.env.JWT_SECRET || 'default-secret');
        userId = decoded.id;
      } catch (error) {
        console.error('Token decode error:', error.message);
        return res.status(401).json({
          success: false,
          message: 'Invalid or expired token'
        });
      }
    }

    // Fall back to session
    if (!userId && req.session?.passport?.user) {
      userId = req.session.passport.user._id || req.session.passport.user;
    }

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    // Get user and their tenant
    const user = await User.findById(userId).populate('tenant');
    if (!user || !user.tenant) {
      return res.status(404).json({
        success: false,
        message: 'User or tenant not found'
      });
    }

    const tenant = user.tenant;

    // Find an active API key for this tenant
    const activeApiKey = tenant.apiKeys?.find(key => key.isActive);
    if (!activeApiKey) {
      return res.status(400).json({
        success: false,
        message: 'No active API keys found. Please generate an API key first.'
      });
    }

    // Generate the dids.conf file content
    const configContent = `# VICIdial DID Optimizer Configuration
# Generated: ${new Date().toISOString()}
# Tenant: ${tenant.name}
# API Key ID: ${activeApiKey.name || activeApiKey._id}
#
# IMPORTANT: Keep this file secure. Do not commit to version control.

# API Configuration
API_BASE_URL=${process.env.API_BASE_URL || process.env.FRONTEND_URL || 'http://localhost:5000'}/api/v1
API_KEY=${activeApiKey.key}

# VICIdial Database Configuration (update with your values)
# VICIDIAL_DB_HOST=localhost
# VICIDIAL_DB_PORT=3306
# VICIDIAL_DB_NAME=asterisk
# VICIDIAL_DB_USER=cron
# VICIDIAL_DB_PASS=your-password

# DID Selection Strategy
# Options: round-robin, least-used, performance-based, geo-proximity
DID_SELECTION_STRATEGY=round-robin

# Logging Configuration
LOG_LEVEL=INFO
LOG_FILE=/var/log/astguiclient/did-optimizer.log

# Cache Settings (optional)
CACHE_TTL=300
ENABLE_CACHE=true

# Rate Limiting
MAX_REQUESTS_PER_MINUTE=60

# Health Check Settings
HEALTH_CHECK_INTERVAL=60
HEALTH_CHECK_TIMEOUT=5

# Tenant Configuration
TENANT_ID=${tenant._id}
TENANT_NAME=${tenant.name}

# GitHub Repository
GITHUB_REPO=https://github.com/yourusername/did-optimizer-vicidial
`;

    res.set('Content-Type', 'text/plain');
    res.set('Content-Disposition', 'attachment; filename="dids.conf"');
    res.send(configContent);

  } catch (error) {
    console.error('VICIdial config generation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate configuration',
      error: error.message
    });
  }
});

// GET DID Reputation Details
app.get('/api/v1/dids/:phoneNumber/reputation', async (req, res) => {
  try {
    const { phoneNumber } = req.params;

    // Find DID by phone number - try both with and without + prefix
    const cleanedNumber = phoneNumber.replace(/\D/g, ''); // Remove non-digits
    const did = await DID.findOne({
      $or: [
        { phoneNumber: `+${cleanedNumber}` },  // With + prefix
        { phoneNumber: cleanedNumber }         // Without prefix
      ]
    }).lean();

    if (!did) {
      return res.status(404).json({
        success: false,
        message: 'DID not found'
      });
    }

    // Calculate actual metrics from real data
    const totalCalls = did.usage?.totalCalls || 0;
    const totalAnswered = did.metrics?.totalAnswered || 0;
    const totalConnected = did.metrics?.totalConnected || 0;
    const totalDropped = did.metrics?.totalDropped || 0;
    const totalFailed = did.metrics?.totalFailed || 0;
    const totalBusy = did.metrics?.totalBusy || 0;
    const totalDuration = did.metrics?.totalDuration || 0;

    // Calculate success rate from real metrics
    const successRate = totalCalls > 0 ? Math.round((totalConnected / totalCalls) * 100) : 0;
    const answerRate = totalCalls > 0 ? Math.round((totalAnswered / totalCalls) * 100) : 0;

    // Calculate average call duration
    const avgDuration = totalConnected > 0 ? Math.round(totalDuration / totalConnected) : 0;
    const avgDurationFormatted = avgDuration > 0 ? `${Math.floor(avgDuration / 60)}m ${avgDuration % 60}s` : '0s';

    // Use real reputation data with intelligent fallbacks
    const reputationDetails = {
      score: did.reputation?.score || 50,
      lastChecked: did.reputation?.lastChecked || did.updatedAt || new Date().toISOString(),
      robokiller: {
        status: did.reputation?.robokillerData?.robokillerStatus || 'Unknown',
        lastChecked: did.reputation?.robokillerData?.lastCallDate || did.reputation?.lastChecked || null,
        reports: did.reputation?.robokillerData?.userReports || 0,
        category: did.reputation?.robokillerData?.reputationStatus || 'Not Listed',
        flagReason: did.reputation?.robokillerData?.flagReason || null,
        spamScore: did.reputation?.robokillerData?.spamScore || null,
        callerName: did.reputation?.robokillerData?.callerName || null,
        commentsCount: did.reputation?.robokillerData?.commentsCount || 0,
        screenshot: did.reputation?.robokillerData?.screenshot || null
      },
      callStats: {
        totalCalls: totalCalls,
        answeredCalls: totalAnswered,
        connectedCalls: totalConnected,
        droppedCalls: totalDropped,
        failedCalls: totalFailed,
        busyCalls: totalBusy,
        reportedSpam: did.reputation?.robokillerData?.userReports || 0,
        blockedCalls: totalDropped + totalFailed,
        averageCallDuration: avgDurationFormatted,
        successRate: `${successRate}%`,
        answerRate: `${answerRate}%`,
        totalDuration: totalDuration
      },
      userComments: did.reputation?.userComments || (
        did.reputation?.robokillerData?.commentsCount > 0
          ? [
              {
                date: did.reputation?.lastChecked || new Date().toISOString(),
                comment: `${did.reputation.robokillerData.commentsCount} user reports available on RoboKiller`,
                rating: 'neutral',
                source: 'RoboKiller Database'
              }
            ]
          : [
              {
                date: did.createdAt || new Date().toISOString(),
                comment: 'No user reports available',
                rating: 'neutral',
                source: 'System'
              }
            ]
      ),
      history: did.reputation?.history || [
        {
          date: did.createdAt || new Date().toISOString(),
          score: did.reputation?.score || 50,
          event: 'DID added to system',
          change: 0
        },
        ...(did.reputation?.lastChecked ? [{
          date: did.reputation.lastChecked,
          score: did.reputation?.score || 50,
          event: 'Reputation check',
          change: 0
        }] : [])
      ],
      carrierInfo: {
        carrier: did.metadata?.carrier || did.reputation?.robokillerData?.carrier || 'Unknown',
        type: did.metadata?.lineType || 'Unknown',
        location: {
          city: did.location?.city || 'Unknown',
          state: did.location?.state || 'Unknown',
          areaCode: did.location?.areaCode || phoneNumber.substring(1, 4),
          country: did.location?.country || 'US'
        }
      },
      riskFactors: did.reputation?.riskFactors || [],
      lastActivity: did.usage?.lastUsed || did.metrics?.lastCallTimestamp || did.updatedAt || new Date().toISOString(),
      campaignInfo: {
        lastCampaign: did.usage?.lastCampaign || 'Unknown',
        lastAgent: did.usage?.lastAgent || 'Unknown',
        lastCallResult: did.metrics?.lastCallResult || 'Unknown'
      },
      dailyUsage: did.usage?.dailyUsage || [],
      metadata: {
        notes: did.metadata?.notes || '',
        portedDate: did.metadata?.portedDate || null,
        capacity: did.capacity || 100,
        status: did.status || 'active',
        isActive: did.isActive !== false
      }
    };

    res.json({
      success: true,
      data: reputationDetails
    });

  } catch (error) {
    console.error('Error fetching reputation details:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch reputation details',
      error: error.message
    });
  }
});

// API Keys endpoints - Session-based versions for frontend
app.get('/api/v1/tenants/api-keys', async (req, res) => {
  try {
    console.log('🔑 API Keys endpoint called');
    console.log('📍 Request URL:', req.originalUrl);
    console.log('📋 Headers:', {
      authorization: req.headers.authorization ? 'Bearer token present' : 'No token',
      contentType: req.headers['content-type'],
      origin: req.headers.origin
    });

    // Get user from session or token
    let userId = null;
    let userTenantId = null;

    // Try token first
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token) {
      try {
        const decoded = jsonwebtoken.verify(token, process.env.JWT_SECRET || 'default-secret');
        console.log('✅ Token decoded successfully:', {
          id: decoded.id,
          email: decoded.email,
          role: decoded.role
        });
        userId = decoded.id;
      } catch (error) {
        console.error('❌ Token decode error:', error.message);
        return res.status(401).json({
          success: false,
          message: 'Invalid or expired token. Please login again.'
        });
      }
    }

    // Fall back to session
    if (!userId && req.session && req.session.passport && req.session.passport.user) {
      userId = req.session.passport.user._id;
      console.log('📌 Using session user ID:', userId);
    }

    if (!userId) {
      console.log('❌ No user ID found from token or session');
      return res.status(401).json({
        success: false,
        message: 'Authentication required. Please login.'
      });
    }

    console.log('🔍 Looking for user with ID:', userId);

    // Get user and tenant
    let user = await User.findById(userId);
    console.log('👤 User found:', user ? `Yes - ${user.email}` : 'No');

    if (!user) {
      console.log('❌ User not found with ID:', userId);
      return res.status(404).json({
        success: false,
        message: 'User account not found'
      });
    }

    if (!user.tenant) {
      console.log('⚠️ User has no tenant assigned:', user.email);
      return res.status(404).json({
        success: false,
        message: 'No organization found for this user. Please contact support.'
      });
    }

    // Handle both ObjectId and String formats for backwards compatibility
    userTenantId = user.tenant._id || user.tenant;
    console.log('🏢 User tenant ID:', userTenantId);

    // Get tenant with API keys
    const tenant = await Tenant.findById(userTenantId);
    if (!tenant) {
      console.log('❌ Tenant not found for ID:', userTenantId);
      return res.status(404).json({
        success: false,
        message: 'Organization not found. Please contact support.'
      });
    }

    console.log('✅ Tenant found:', tenant.name, 'with', tenant.apiKeys?.length || 0, 'API keys');

    // Format API keys for frontend - include full key for display
    const apiKeys = (tenant.apiKeys || []).map(key => ({
      _id: key._id,
      name: key.name,
      permissions: key.permissions,
      isActive: key.isActive,
      lastUsed: key.lastUsed,
      createdAt: key.createdAt,
      key: key.key // Send full key - frontend will handle masking
    }));

    console.log(`📤 Returning ${apiKeys.length} API keys to frontend`);

    res.json({
      success: true,
      data: apiKeys,
      tenant: {
        id: tenant._id,
        name: tenant.name
      }
    });
  } catch (error) {
    console.error('💥 API Keys list error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to load API keys. Please try again later.',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

app.post('/api/v1/tenants/api-keys', async (req, res) => {
  console.log('🔵 API Key creation endpoint hit:', req.body);
  try {
    // Get user from session or token
    let userId = null;

    // Try token first
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token) {
      try {
        const decoded = jsonwebtoken.verify(token, process.env.JWT_SECRET || 'default-secret');
        userId = decoded.id;
      } catch (error) {
        console.error('Token decode error:', error.message);
      }
    }

    // Fall back to session
    if (!userId && req.session && req.session.passport && req.session.passport.user) {
      userId = req.session.passport.user._id;
    }

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    // Get user and tenant
    const user = await User.findById(userId);
    if (!user || !user.tenant) {
      return res.status(404).json({
        success: false,
        message: 'User or tenant not found'
      });
    }

    const { name, permissions = ['read', 'write'] } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'API key name is required'
      });
    }

    // Get tenant
    const tenant = await Tenant.findById(user.tenant);
    if (!tenant) {
      return res.status(404).json({
        success: false,
        message: 'Tenant not found'
      });
    }

    // Check if API key name already exists
    const existingKey = tenant.apiKeys.find(key => key.name === name && key.isActive);
    if (existingKey) {
      console.log('🔴 API Key conflict detected:', name);
      // Return 200 with success:false to avoid Cloudflare error page interception
      return res.status(200).json({
        success: false,
        error: 'conflict',
        message: 'API key with this name already exists'
      });
    }

    // Generate new API key
    const crypto = await import('crypto');
    const apiKey = 'did_' + crypto.randomBytes(32).toString('hex');

    const newKey = {
      _id: new mongoose.Types.ObjectId(),
      name,
      key: apiKey,
      permissions,
      isActive: true,
      lastUsed: null,
      createdAt: new Date()
    };

    tenant.apiKeys.push(newKey);
    await tenant.save();

    res.status(201).json({
      success: true,
      message: 'API key created successfully',
      data: {
        _id: newKey._id,
        name: newKey.name,
        key: apiKey, // Return full key only on creation
        permissions: newKey.permissions,
        isActive: newKey.isActive,
        createdAt: newKey.createdAt
      }
    });
  } catch (error) {
    console.error('🔴 API Key creation error:', error);
    console.error('🔴 Error stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Failed to create API key'
    });
  }
});

app.delete('/api/v1/tenants/api-keys/:keyId', async (req, res) => {
  try {
    // Get user from session or token
    let userId = null;

    // Try token first
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token) {
      try {
        const decoded = jsonwebtoken.verify(token, process.env.JWT_SECRET || 'default-secret');
        userId = decoded.id;
      } catch (error) {
        console.error('Token decode error:', error.message);
      }
    }

    // Fall back to session
    if (!userId && req.session && req.session.passport && req.session.passport.user) {
      userId = req.session.passport.user._id;
    }

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    // Get user and tenant
    const user = await User.findById(userId);
    if (!user || !user.tenant) {
      return res.status(404).json({
        success: false,
        message: 'User or tenant not found'
      });
    }

    // Get tenant
    const tenant = await Tenant.findById(user.tenant);
    if (!tenant) {
      return res.status(404).json({
        success: false,
        message: 'Tenant not found'
      });
    }

    // Find and deactivate the API key
    const apiKey = tenant.apiKeys.id(req.params.keyId);
    if (!apiKey) {
      return res.status(404).json({
        success: false,
        message: 'API key not found'
      });
    }

    apiKey.isActive = false;
    await tenant.save();

    res.json({
      success: true,
      message: 'API key deactivated successfully'
    });
  } catch (error) {
    console.error('API Key deletion error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete API key'
    });
  }
});

// Mock rotation rules endpoints for Settings page
app.get('/api/v1/rotation-rules', async (req, res) => {
  res.json({
    data: {
      rules: []
    }
  });
});

app.get('/api/v1/rotation-rules/templates/list', async (req, res) => {
  res.json({
    data: {
      templates: []
    }
  });
});

app.get('/api/v1/rotation-rules/analytics/overview', async (req, res) => {
  res.json({
    data: {
      analytics: {
        totalRules: 0,
        activeRules: 0,
        averageEffectiveness: 85,
        recentViolations: [],
        algorithmDistribution: {}
      }
    }
  });
});

// Analytics API Endpoints
app.get('/api/v1/analytics/realtime', async (req, res) => {
  try {
    // Get user from token
    const token = req.headers.authorization?.replace('Bearer ', '');
    let userTenantId = null;
    let isAdmin = false;

    if (token) {
      try {
        const decoded = jsonwebtoken.verify(token, process.env.JWT_SECRET || 'default-secret');
        const user = await User.findById(decoded.id);
        if (user) {
          userTenantId = user.tenant;
          isAdmin = user.role === 'ADMIN' || user.role === 'SUPER_ADMIN';
        }
      } catch (error) {
        console.error('Token decode error:', error.message);
      }
    }

    // Build query filters
    const tenantId = userTenantId && !isAdmin ?
      (mongoose.Types.ObjectId.isValid(userTenantId) ?
        new mongoose.Types.ObjectId(userTenantId) : userTenantId) : null;

    const didQuery = tenantId ? { tenantId } : {};
    const callQuery = tenantId ? { tenantId: tenantId.toString() } : {};

    // Get today's date range
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Get real-time stats
    const [activeCalls, totalCallsToday, successfulCallsToday, totalDids, activeDids] = await Promise.all([
      CallRecord.countDocuments({ ...callQuery, disposition: 'initiated', callTimestamp: { $gte: today } }),
      CallRecord.countDocuments({ ...callQuery, callTimestamp: { $gte: today } }),
      CallRecord.countDocuments({ ...callQuery, result: 'answered', callTimestamp: { $gte: today } }),
      DID.countDocuments(didQuery),
      DID.countDocuments({ ...didQuery, status: 'active' })
    ]);

    const avgAnswerRate = totalCallsToday > 0 ?
      (successfulCallsToday / totalCallsToday) * 100 : 0;

    const didUtilization = totalDids > 0 ? activeDids / totalDids : 0;

    res.json({
      data: {
        activeCalls,
        todayStats: {
          totalCallsToday,
          avgAnswerRate
        },
        systemHealth: {
          didUtilization
        }
      }
    });
  } catch (error) {
    console.error('Analytics realtime error:', error);
    res.status(500).json({ message: 'Failed to load realtime analytics' });
  }
});

app.get('/api/v1/analytics/performance', async (req, res) => {
  try {
    const { period = 'month', metric = 'calls' } = req.query;

    // Get user from token
    const token = req.headers.authorization?.replace('Bearer ', '');
    let userTenantId = null;
    let isAdmin = false;

    if (token) {
      try {
        const decoded = jsonwebtoken.verify(token, process.env.JWT_SECRET || 'default-secret');
        const user = await User.findById(decoded.id);
        if (user) {
          userTenantId = user.tenant;
          isAdmin = user.role === 'ADMIN' || user.role === 'SUPER_ADMIN';
        }
      } catch (error) {
        console.error('Token decode error:', error.message);
      }
    }

    // Build query filters
    const tenantId = userTenantId && !isAdmin ?
      (mongoose.Types.ObjectId.isValid(userTenantId) ?
        new mongoose.Types.ObjectId(userTenantId) : userTenantId) : null;

    const didQuery = tenantId ? { tenantId } : {};

    // Calculate date range based on period
    const endDate = new Date();
    const startDate = new Date();

    switch(period) {
      case 'today':
        startDate.setHours(0, 0, 0, 0);
        break;
      case 'week':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case 'month':
        startDate.setDate(startDate.getDate() - 30);
        break;
      case 'quarter':
        startDate.setMonth(startDate.getMonth() - 3);
        break;
      case 'year':
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
      default:
        startDate.setDate(startDate.getDate() - 30);
    }

    // Get top performing DIDs
    const topPerformers = await DID.find({
      ...didQuery,
      status: 'active',
      'reputation.score': { $exists: true }
    })
    .sort({ 'reputation.score': -1 })
    .limit(6)
    .lean();

    const formattedPerformers = topPerformers.map(did => ({
      number: did.phoneNumber,
      quality: {
        score: did.reputation?.score || 0,
        answerRate: Math.round((did.reputation?.successRate || 0) * 100)
      }
    }));

    // Create trends array (simplified for now)
    const trends = period !== 'today' ? [{
      date: startDate.toISOString(),
      value: metric === 'calls' ? 100 :
             metric === 'answer_rate' ? 85 :
             metric === 'utilization' ? 75 : 90
    }] : [];

    res.json({
      data: {
        trends,
        topPerformers: formattedPerformers
      }
    });
  } catch (error) {
    console.error('Analytics performance error:', error);
    res.status(500).json({ message: 'Failed to load performance analytics' });
  }
});

app.get('/api/v1/analytics/costs', async (req, res) => {
  try {
    const { period = 'month' } = req.query;

    // Get user from token
    const token = req.headers.authorization?.replace('Bearer ', '');
    let userTenantId = null;
    let isAdmin = false;

    if (token) {
      try {
        const decoded = jsonwebtoken.verify(token, process.env.JWT_SECRET || 'default-secret');
        const user = await User.findById(decoded.id);
        if (user) {
          userTenantId = user.tenant;
          isAdmin = user.role === 'ADMIN' || user.role === 'SUPER_ADMIN';
        }
      } catch (error) {
        console.error('Token decode error:', error.message);
      }
    }

    // Build query filters
    const tenantId = userTenantId && !isAdmin ?
      (mongoose.Types.ObjectId.isValid(userTenantId) ?
        new mongoose.Types.ObjectId(userTenantId) : userTenantId) : null;

    const didQuery = tenantId ? { tenantId } : {};
    const callQuery = tenantId ? { tenantId: tenantId.toString() } : {};

    // Get DIDs for cost calculation
    const dids = await DID.find(didQuery).lean();
    const totalDIDs = dids.length;

    // Calculate costs (example rates)
    const costPerDID = 2.50; // $2.50 per DID per month
    const totalMonthlyCosts = totalDIDs * costPerDID;
    const avgCostPerDID = totalDIDs > 0 ? totalMonthlyCosts / totalDIDs : 0;

    // Group by carrier if available
    const carrierGroups = {};
    for (const did of dids) {
      const carrier = did.carrier || 'Unknown';
      if (!carrierGroups[carrier]) {
        carrierGroups[carrier] = {
          _id: carrier,
          didCount: 0,
          totalCalls: 0,
          totalCosts: 0
        };
      }
      carrierGroups[carrier].didCount++;
      carrierGroups[carrier].totalCosts += costPerDID;

      // Get call count for this DID
      const callCount = await CallRecord.countDocuments({
        ...callQuery,
        didId: did._id.toString()
      });
      carrierGroups[carrier].totalCalls += callCount;
    }

    const costByCarrier = Object.values(carrierGroups)
      .sort((a, b) => b.totalCosts - a.totalCosts)
      .slice(0, 5);

    res.json({
      data: {
        summary: {
          totalMonthlyCosts,
          totalDIDs,
          avgCostPerDID
        },
        costByCarrier
      }
    });
  } catch (error) {
    console.error('Analytics costs error:', error);
    res.status(500).json({ message: 'Failed to load cost analytics' });
  }
});

// Capacity Analytics Endpoint - Using TimescaleDB for call data
app.get('/api/v1/analytics/capacity', async (req, res) => {
  try {
    const startTime = Date.now();

    // Get user from token
    const token = req.headers.authorization?.replace('Bearer ', '');
    let userTenantId = null;
    let isAdmin = false;

    if (token) {
      try {
        const decoded = jsonwebtoken.verify(token, process.env.JWT_SECRET || 'default-secret');
        const user = await User.findById(decoded.id);
        if (user) {
          userTenantId = user.tenant || user.tenantId;
          isAdmin = user.role === 'ADMIN' || user.role === 'SUPER_ADMIN';
          console.log('📊 Capacity - User tenant:', userTenantId, 'isAdmin:', isAdmin);
        }
      } catch (error) {
        console.error('Token decode error:', error.message);
      }
    }

    // If no tenant found, return error
    if (!userTenantId && !isAdmin) {
      return res.status(401).json({ success: false, message: 'Unauthorized - no tenant found' });
    }

    // Calculate last business day (exclude weekends)
    const getLastBusinessDay = () => {
      const today = new Date();
      let lastBusinessDay = new Date(today);
      lastBusinessDay.setDate(today.getDate() - 1); // Start with yesterday

      // If yesterday was Sunday (0), go back to Friday
      if (lastBusinessDay.getDay() === 0) {
        lastBusinessDay.setDate(lastBusinessDay.getDate() - 2);
      }
      // If yesterday was Saturday (6), go back to Friday
      else if (lastBusinessDay.getDay() === 6) {
        lastBusinessDay.setDate(lastBusinessDay.getDate() - 1);
      }

      lastBusinessDay.setHours(0, 0, 0, 0);
      return lastBusinessDay;
    };

    const lastBusinessDayStart = getLastBusinessDay();
    const lastBusinessDayEnd = new Date(lastBusinessDayStart);
    lastBusinessDayEnd.setHours(23, 59, 59, 999);

    console.log('📊 Capacity analytics (TimescaleDB) - Last business day:', lastBusinessDayStart.toISOString().split('T')[0]);

    // Build MongoDB query filter for DIDs
    const filter = { status: 'active' };
    if (!isAdmin && userTenantId) {
      filter.tenantId = userTenantId;
    }

    // Get total DIDs from MongoDB
    const totalDIDs = await DID.countDocuments(filter);

    // Get DIDs with usage in last 7 days from MongoDB
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const activeDIDs = await DID.countDocuments({
      ...filter,
      'usage.lastUsed': { $gte: sevenDaysAgo }
    });

    // Calculate last 7 business days (excluding weekends)
    const businessDays = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let daysFound = 0;
    let currentDate = new Date(today);

    while (daysFound < 7) {
      currentDate.setDate(currentDate.getDate() - 1);
      const dayOfWeek = currentDate.getDay();
      // Skip weekends (0 = Sunday, 6 = Saturday)
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        businessDays.push(new Date(currentDate));
        daysFound++;
      }
    }

    const oldestBusinessDay = businessDays[businessDays.length - 1];
    oldestBusinessDay.setHours(0, 0, 0, 0);

    console.log(`📊 Calculating capacity for last 7 business days (${oldestBusinessDay.toISOString().split('T')[0]} to ${today.toISOString().split('T')[0]})`);

    // Get all DIDs for this tenant from MongoDB
    const allDIDs = await DID.find(filter).lean();

    // ========== TIMESCALEDB QUERIES ==========
    // Get calls per DID from TimescaleDB using call_stats_daily continuous aggregate
    const tenantFilter = !isAdmin && userTenantId ? userTenantId.toString() : null;

    // Query 1: Get call counts per DID from TimescaleDB
    const didCallsQuery = `
      SELECT did_id, SUM(call_count) as total_calls
      FROM call_stats_daily
      WHERE bucket >= $1 AND bucket < $2
        ${tenantFilter ? 'AND tenant_id = $3' : ''}
        AND did_id IS NOT NULL
      GROUP BY did_id
    `;
    const didCallsParams = tenantFilter
      ? [oldestBusinessDay.toISOString(), today.toISOString(), tenantFilter]
      : [oldestBusinessDay.toISOString(), today.toISOString()];

    let didCallCounts = [];
    try {
      const didCallsResult = await timescalePool.query(didCallsQuery, didCallsParams);
      didCallCounts = didCallsResult.rows;
      console.log(`📊 TimescaleDB: Found ${didCallCounts.length} DIDs with calls`);
    } catch (tsError) {
      console.warn('⚠️ TimescaleDB query failed, falling back to MongoDB:', tsError.message);
      // Fallback to MongoDB if TimescaleDB fails
      const mongoResult = await CallRecord.aggregate([
        {
          $match: {
            ...(!isAdmin && userTenantId ? { tenantId: userTenantId } : {}),
            callTimestamp: { $gte: oldestBusinessDay, $lt: today },
            selectedDID: { $exists: true, $ne: null }
          }
        },
        { $group: { _id: '$selectedDID', total_calls: { $sum: 1 } } }
      ]);
      didCallCounts = mongoResult.map(r => ({ did_id: r._id, total_calls: r.total_calls }));
    }

    // Create a map of DID to call count
    const didCallMap = new Map();
    didCallCounts.forEach(item => {
      didCallMap.set(item.did_id, parseInt(item.total_calls));
    });

    // Calculate capacity stats with average daily usage
    const capacityStats = allDIDs.map(did => {
      const totalCallsLast7Days = didCallMap.get(did.phoneNumber) || 0;
      const avgCallsPerDay = totalCallsLast7Days / 7; // Average over 7 business days
      const capacity = did.capacity || 100;
      const utilizationRate = capacity > 0 ? (avgCallsPerDay / capacity) * 100 : 0;

      return {
        phoneNumber: did.phoneNumber,
        capacity,
        totalCalls: totalCallsLast7Days,
        avgCallsPerDay: Math.round(avgCallsPerDay * 10) / 10,
        lastUsed: did.usage?.lastUsed,
        location: did.location,
        utilizationRate: Math.round(utilizationRate * 10) / 10
      };
    }).sort((a, b) => b.utilizationRate - a.utilizationRate);

    // Find over-capacity DIDs (>80% utilization)
    const overCapacityDIDs = capacityStats.filter(d => d.utilizationRate > 80);

    // Query 2: Get destination area codes from TimescaleDB (for last business day)
    const destAreaCodesQuery = `
      SELECT
        CASE
          WHEN phone_number LIKE '+1%' THEN SUBSTRING(phone_number FROM 3 FOR 3)
          WHEN phone_number LIKE '1%' AND LENGTH(phone_number) >= 11 THEN SUBSTRING(phone_number FROM 2 FOR 3)
          WHEN LENGTH(phone_number) >= 10 THEN SUBSTRING(phone_number FROM 1 FOR 3)
          ELSE NULL
        END as dest_area_code,
        COUNT(*) as call_count
      FROM call_records
      WHERE call_timestamp >= $1 AND call_timestamp <= $2
        ${tenantFilter ? 'AND tenant_id = $3' : ''}
        AND phone_number IS NOT NULL
        AND phone_number != ''
      GROUP BY dest_area_code
      HAVING CASE
          WHEN phone_number LIKE '+1%' THEN SUBSTRING(phone_number FROM 3 FOR 3)
          WHEN phone_number LIKE '1%' AND LENGTH(phone_number) >= 11 THEN SUBSTRING(phone_number FROM 2 FOR 3)
          WHEN LENGTH(phone_number) >= 10 THEN SUBSTRING(phone_number FROM 1 FOR 3)
          ELSE NULL
        END ~ '^[0-9]{3}$'
      ORDER BY call_count DESC
      LIMIT 50
    `;
    const destAreaCodesParams = tenantFilter
      ? [lastBusinessDayStart.toISOString(), lastBusinessDayEnd.toISOString(), tenantFilter]
      : [lastBusinessDayStart.toISOString(), lastBusinessDayEnd.toISOString()];

    let destinationAreaCodes = [];
    try {
      const destResult = await timescalePool.query(destAreaCodesQuery, destAreaCodesParams);
      destinationAreaCodes = destResult.rows.filter(r => r.dest_area_code);
      console.log(`📊 TimescaleDB: Found ${destinationAreaCodes.length} destination area codes`);
    } catch (tsError) {
      console.warn('⚠️ TimescaleDB destination query failed:', tsError.message);
      // Keep empty array, will skip destination recommendations
    }

    // Calculate area code stats from MongoDB DID data + TimescaleDB call counts
    const areaCodeStats = await DID.aggregate([
      { $match: { ...filter, 'location.areaCode': { $exists: true } } },
      {
        $group: {
          _id: '$location.areaCode',
          state: { $first: '$location.state' },
          city: { $first: '$location.city' },
          didCount: { $sum: 1 },
          totalCapacity: { $sum: '$capacity' },
          phoneNumbers: { $push: '$phoneNumber' }
        }
      }
    ]);

    // Add call data from TimescaleDB and calculate average utilization
    const areaCodeStatsWithCalls = areaCodeStats.map(ac => {
      // Sum calls for all DIDs in this area code
      const totalCalls = ac.phoneNumbers.reduce((sum, phone) => {
        return sum + (didCallMap.get(phone) || 0);
      }, 0);
      const avgCallsPerDay = totalCalls / 7;
      const avgUtilization = ac.totalCapacity > 0 ? (avgCallsPerDay / (ac.totalCapacity / ac.didCount)) * 100 : 0;

      return {
        _id: ac._id,
        state: ac.state,
        city: ac.city,
        didCount: ac.didCount,
        totalCapacity: ac.totalCapacity,
        totalCalls,
        avgUtilization: Math.round(avgUtilization * 10) / 10
      };
    }).sort((a, b) => b.totalCalls - a.totalCalls).slice(0, 20);

    // Calculate overall capacity with 7-day average
    const totalCapacity = capacityStats.reduce((sum, d) => sum + (d.capacity || 0), 0);
    const totalCallsLast7Days = capacityStats.reduce((sum, d) => sum + (d.totalCalls || 0), 0);
    const avgDailyUsage = totalCallsLast7Days / 7;
    const overallUtilization = totalCapacity > 0 ? (avgDailyUsage / totalCapacity) * 100 : 0;

    console.log(`📊 Capacity Summary: Total Capacity=${totalCapacity}, Avg Daily Usage=${Math.round(avgDailyUsage)}, Utilization=${overallUtilization.toFixed(1)}%`);

    // Check which destination area codes we DON'T have DIDs for
    const existingDIDAreaCodes = new Set(areaCodeStats.map(ac => ac._id));
    const destinationStats = await Promise.all(
      destinationAreaCodes.map(async (dest) => {
        // Look up location info from AreaCodeLocation collection (includes US + Canada)
        const locationData = await AreaCodeLocation.findOne({
          areaCode: dest.dest_area_code
        }).lean();

        const hasDIDs = existingDIDAreaCodes.has(dest.dest_area_code);
        const currentDIDCount = hasDIDs ?
          areaCodeStats.find(ac => ac._id === dest.dest_area_code)?.didCount || 0 : 0;

        return {
          areaCode: dest.dest_area_code,
          callCount: parseInt(dest.call_count),
          hasDIDs: hasDIDs,
          currentDIDCount: currentDIDCount,
          location: locationData ? {
            state: locationData.state,
            city: locationData.city,
            country: locationData.country,
            areaCode: dest.dest_area_code
          } : null,
          needsMore: !hasDIDs || currentDIDCount < 5 // Suggest if no DIDs or very few
        };
      })
    );

    // Generate recommendations
    const recommendations = [];

    // Calculate average DID capacity for recommendations
    const avgDIDCapacity = totalDIDs > 0 ? totalCapacity / totalDIDs : 100;
    const targetCallsPerDID = avgDIDCapacity * 0.7; // Target 70% utilization

    console.log(`📊 Recommendation parameters: Avg DID capacity: ${Math.round(avgDIDCapacity)}, Target calls/DID: ${Math.round(targetCallsPerDID)}`);

    // PRIORITY 1: Destination area codes where we need local presence
    const destinationRecommendations = destinationStats
      .filter(dest => dest.needsMore && dest.callCount > 0)
      .map(dest => ({
        type: 'destination',
        areaCode: dest.areaCode,
        state: dest.location?.state || 'Unknown',
        city: dest.location?.city || 'Unknown',
        currentDIDs: dest.currentDIDCount,
        totalCalls: dest.callCount,
        suggestedDIDs: dest.hasDIDs ?
          Math.max(1, Math.ceil((dest.callCount / targetCallsPerDID) - dest.currentDIDCount)) :
          Math.max(1, Math.ceil(dest.callCount / targetCallsPerDID)),
        reason: dest.hasDIDs ?
          `Yesterday: ${dest.callCount} calls in this area - need more local DIDs` :
          `Yesterday: ${dest.callCount} calls to this area - need local presence`,
        priority: dest.hasDIDs ? 'medium' : 'high'
      }));

    recommendations.push(...destinationRecommendations);

    // PRIORITY 2: High traffic, low DID count area codes (existing DIDs overloaded)
    const highTrafficLowDIDs = areaCodeStatsWithCalls.filter(ac => {
      const callsPerDID = (ac.totalCalls || 0) / ac.didCount;
      return callsPerDID > 50 && ac.didCount < 10;
    }).map(ac => ({
      type: 'capacity',
      areaCode: ac._id,
      state: ac.state,
      city: ac.city,
      currentDIDs: ac.didCount,
      totalCalls: ac.totalCalls,
      callsPerDID: Math.round((ac.totalCalls || 0) / ac.didCount),
      suggestedDIDs: Math.ceil(((ac.totalCalls || 0) / ac.didCount) / 50),
      reason: 'High traffic per DID - capacity issue',
      priority: 'medium'
    }));

    recommendations.push(...highTrafficLowDIDs);

    // Overall capacity warning
    if (overallUtilization > 70) {
      const additionalDIDsNeeded = Math.ceil((avgDailyUsage - totalCapacity * 0.7) / 100);
      recommendations.push({
        type: 'system',
        severity: overallUtilization > 100 ? 'critical' : 'warning',
        message: `System is running at ${overallUtilization.toFixed(1)}% capacity`,
        suggestedDIDs: additionalDIDsNeeded,
        reason: 'Overall system capacity exceeded'
      });
    }

    // Top over-capacity DIDs for display
    const topOverCapacity = overCapacityDIDs.slice(0, 10).map(d => ({
      phoneNumber: d.phoneNumber,
      areaCode: d.location?.areaCode || 'N/A',
      utilizationRate: Math.round(d.utilizationRate),
      totalCalls: d.totalCalls || 0,
      capacity: d.capacity || 0
    }));

    const queryTime = Date.now() - startTime;
    console.log(`📊 Capacity analytics completed in ${queryTime}ms (TimescaleDB)`);

    res.json({
      success: true,
      data: {
        summary: {
          totalDIDs,
          activeDIDs,
          overCapacityCount: overCapacityDIDs.length,
          totalCapacity,
          totalUsage: Math.round(avgDailyUsage),
          overallUtilization: Math.round(overallUtilization * 10) / 10
        },
        topOverCapacity,
        areaCodeStats: areaCodeStatsWithCalls.map(ac => ({
          areaCode: ac._id,
          state: ac.state,
          city: ac.city,
          didCount: ac.didCount,
          totalCalls: ac.totalCalls || 0,
          avgUtilization: Math.round((ac.avgUtilization || 0) * 10) / 10,
          callsPerDID: Math.round((ac.totalCalls || 0) / ac.didCount)
        })),
        destinationStats: destinationStats.map(dest => ({
          areaCode: dest.areaCode,
          state: dest.location?.state || 'Unknown',
          city: dest.location?.city || 'Unknown',
          callCount: dest.callCount,
          hasDIDs: dest.hasDIDs,
          currentDIDCount: dest.currentDIDCount,
          needsMore: dest.needsMore
        })),
        recommendations
      },
      metadata: {
        queryTime: `${queryTime}ms`,
        source: 'timescaledb'
      }
    });
  } catch (error) {
    console.error('Analytics capacity error:', error);
    res.status(500).json({ success: false, message: 'Failed to load capacity analytics' });
  }
});

// ============================================================================
// TimescaleDB Analytics Proxy Endpoints
// These endpoints proxy requests to the FastAPI service on port 5001
// They handle JWT authentication and translate to API key auth
// ============================================================================

const FASTAPI_URL = 'http://127.0.0.1:5001';

// Helper function to get user's API key from tenant
async function getUserApiKey(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    console.log('getUserApiKey: No token provided');
    return null;
  }

  try {
    const decoded = jsonwebtoken.verify(token, process.env.JWT_SECRET || 'default-secret');
    const user = await User.findById(decoded.id);

    // Get tenant ID from either tenant or tenantId field
    const tenantId = user?.tenant || user?.tenantId;
    if (!user || !tenantId) {
      console.log('getUserApiKey: No user or tenant found');
      return null;
    }

    // Get the tenant with API keys
    const tenant = await Tenant.findById(tenantId);
    if (!tenant || !tenant.apiKeys || tenant.apiKeys.length === 0) {
      console.log('getUserApiKey: No tenant or API keys found for tenant:', tenantId);
      return null;
    }

    // Find an active API key
    const activeKey = tenant.apiKeys.find(k => k.isActive !== false);
    const apiKey = activeKey ? activeKey.key : tenant.apiKeys[0].key;
    console.log('getUserApiKey: Found API key for tenant:', tenant.name);
    return apiKey;
  } catch (error) {
    console.error('Error getting user API key:', error.message);
    return null;
  }
}

// TimescaleDB Summary (Today/Week/Month overview)
app.get('/api/v1/analytics/ts/summary', async (req, res) => {
  try {
    const apiKey = await getUserApiKey(req);
    if (!apiKey) {
      return res.status(401).json({ success: false, message: 'Unauthorized or no API key available' });
    }

    const response = await fetch(`${FASTAPI_URL}/api/v1/analytics/summary`, {
      headers: { 'x-api-key': apiKey }
    });

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    console.error('TimescaleDB summary proxy error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch analytics summary' });
  }
});

// TimescaleDB Realtime stats
app.get('/api/v1/analytics/ts/realtime', async (req, res) => {
  try {
    const apiKey = await getUserApiKey(req);
    if (!apiKey) {
      return res.status(401).json({ success: false, message: 'Unauthorized or no API key available' });
    }

    const minutes = req.query.minutes || 5;
    const response = await fetch(`${FASTAPI_URL}/api/v1/analytics/realtime?minutes=${minutes}`, {
      headers: { 'x-api-key': apiKey }
    });

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    console.error('TimescaleDB realtime proxy error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch realtime analytics' });
  }
});

// TimescaleDB Hourly stats
app.get('/api/v1/analytics/ts/hourly', async (req, res) => {
  try {
    const apiKey = await getUserApiKey(req);
    if (!apiKey) {
      return res.status(401).json({ success: false, message: 'Unauthorized or no API key available' });
    }

    const hours = req.query.hours || 24;
    const response = await fetch(`${FASTAPI_URL}/api/v1/analytics/hourly?hours=${hours}`, {
      headers: { 'x-api-key': apiKey }
    });

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    console.error('TimescaleDB hourly proxy error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch hourly analytics' });
  }
});

// TimescaleDB Daily stats
app.get('/api/v1/analytics/ts/daily', async (req, res) => {
  try {
    const apiKey = await getUserApiKey(req);
    if (!apiKey) {
      return res.status(401).json({ success: false, message: 'Unauthorized or no API key available' });
    }

    const days = req.query.days || 30;
    const response = await fetch(`${FASTAPI_URL}/api/v1/analytics/daily?days=${days}`, {
      headers: { 'x-api-key': apiKey }
    });

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    console.error('TimescaleDB daily proxy error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch daily analytics' });
  }
});

// TimescaleDB Campaign stats
app.get('/api/v1/analytics/ts/campaigns', async (req, res) => {
  try {
    const apiKey = await getUserApiKey(req);
    if (!apiKey) {
      return res.status(401).json({ success: false, message: 'Unauthorized or no API key available' });
    }

    const days = req.query.days || 7;
    const response = await fetch(`${FASTAPI_URL}/api/v1/analytics/campaigns?days=${days}`, {
      headers: { 'x-api-key': apiKey }
    });

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    console.error('TimescaleDB campaigns proxy error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch campaign analytics' });
  }
});

// TimescaleDB Geographic stats
app.get('/api/v1/analytics/ts/geographic', async (req, res) => {
  try {
    const apiKey = await getUserApiKey(req);
    if (!apiKey) {
      return res.status(401).json({ success: false, message: 'Unauthorized or no API key available' });
    }

    const days = req.query.days || 7;
    const response = await fetch(`${FASTAPI_URL}/api/v1/analytics/geographic?days=${days}`, {
      headers: { 'x-api-key': apiKey }
    });

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    console.error('TimescaleDB geographic proxy error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch geographic analytics' });
  }
});

// TimescaleDB DID stats
app.get('/api/v1/analytics/ts/dids', async (req, res) => {
  try {
    const apiKey = await getUserApiKey(req);
    if (!apiKey) {
      return res.status(401).json({ success: false, message: 'Unauthorized or no API key available' });
    }

    const days = req.query.days || 7;
    const response = await fetch(`${FASTAPI_URL}/api/v1/analytics/dids?days=${days}`, {
      headers: { 'x-api-key': apiKey }
    });

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    console.error('TimescaleDB dids proxy error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch DID analytics' });
  }
});

// Health check
app.get('/api/health', validateApiKey, (req, res) => {
  console.log('🏥 Health check endpoint called');
  try {
    res.json({
      status: 'ok',
      environment: process.env.NODE_ENV,
      timestamp: new Date().toISOString()
    });
    console.log('✅ Health check response sent');
  } catch (error) {
    console.error('💥 Health check error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

// API documentation
app.get('/api/v1', (req, res) => {
  res.json({
    message: 'DID Optimizer API v1',
    endpoints: {
      auth: '/api/v1/auth',
      users: '/api/v1/users',
      dids: '/api/v1/dids',
      analytics: '/api/v1/analytics',
      billing: '/api/v1/billing',
      tenants: '/api/v1/tenants'
    },
    health: '/api/health'
  });
});

// Proxy to React development server on port 3000
// This serves the dynamic development version instead of static build
// DISABLED: Using static file serving instead
// const DEV_SERVER_URL = 'http://localhost:3000';
// const proxy = createProxyMiddleware({
//   target: DEV_SERVER_URL,
//   changeOrigin: true,
//   ws: true, // Enable WebSocket proxying for hot reload
//   logLevel: 'info',
//   onError: (err, req, res) => {
//     console.error('Proxy error:', err);
//     res.status(500).send('Development server not available. Please ensure React dev server is running on port 3000.');
//   }
// });

// Only proxy non-API routes to the development server
// DISABLED: Using static file serving instead
// app.use((req, res, next) => {
//   if (req.path.startsWith('/api')) {
//     return next();
//   }
//   proxy(req, res, next);
// });

// All other routes return the React app (catch-all for SPA routing)
app.use((req, res, next) => {
  // Don't serve React app for API routes
  if (req.path.startsWith('/api')) {
    return next();
  }

  const indexPath = path.join(frontendBuildPath, 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) {
      console.error('Error serving index.html:', err);
      res.status(404).json({
        error: true,
        message: 'Frontend not built. Please run: cd frontend && npm run build'
      });
    }
  });
});

// ============================================================================
// ROTATION SETTINGS API
// ============================================================================

// Update global rotation settings
app.patch('/api/v1/settings/rotation', async (req, res) => {
  try {
    // Authenticate user
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'No token provided'
      });
    }

    const decoded = jsonwebtoken.verify(token, process.env.JWT_SECRET || 'default-secret');
    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid token'
      });
    }

    const { globalCapacity } = req.body;

    if (!globalCapacity || typeof globalCapacity !== 'number' || globalCapacity < 1) {
      return res.status(400).json({
        success: false,
        error: 'Invalid globalCapacity value'
      });
    }

    // Update tenant's default DID capacity
    const tenant = await Tenant.findById(user.tenantId);
    if (!tenant) {
      return res.status(404).json({
        success: false,
        error: 'Tenant not found'
      });
    }

    // Store in tenant settings
    if (!tenant.settings) {
      tenant.settings = {};
    }
    tenant.settings.defaultDidCapacity = globalCapacity;
    await tenant.save();

    // Also update environment default for new DIDs
    process.env.DEFAULT_DID_CAPACITY = globalCapacity.toString();

    console.log(`✅ Global capacity updated to ${globalCapacity} for tenant ${tenant.name}`);

    res.json({
      success: true,
      message: 'Global capacity updated successfully',
      data: {
        globalCapacity
      }
    });
  } catch (error) {
    console.error('Error updating rotation settings:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update rotation settings'
    });
  }
});

// Get rotation settings
app.get('/api/v1/settings/rotation', async (req, res) => {
  try {
    // Authenticate user
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'No token provided'
      });
    }

    const decoded = jsonwebtoken.verify(token, process.env.JWT_SECRET || 'default-secret');
    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid token'
      });
    }

    const tenant = await Tenant.findById(user.tenantId);
    if (!tenant) {
      return res.status(404).json({
        success: false,
        error: 'Tenant not found'
      });
    }

    const globalCapacity = tenant.settings?.defaultDidCapacity ||
                          parseInt(process.env.DEFAULT_DID_CAPACITY || '100', 10);

    res.json({
      success: true,
      data: {
        globalCapacity
      }
    });
  } catch (error) {
    console.error('Error fetching rotation settings:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch rotation settings'
    });
  }
});

// ============================================================================
// AI BOT ENDPOINTS FOR BULK DID MANAGEMENT
// ============================================================================

// AI Chat endpoint for DID management
app.post('/api/v1/ai/chat', async (req, res) => {
  try {
    // Authenticate user
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'No token provided'
      });
    }

    const decoded = jsonwebtoken.verify(token, process.env.JWT_SECRET || 'default-secret');
    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid token'
      });
    }

    const { message, context } = req.body;
    if (!message) {
      return res.status(400).json({
        success: false,
        error: 'Message is required'
      });
    }

    // Process the message using AI
    const aiResponse = await processAIMessage(message, context, user.tenantId);

    res.json({
      success: true,
      response: aiResponse.response,
      actions: aiResponse.actions || [],
      data: aiResponse.data || null
    });

  } catch (error) {
    console.error('AI Chat error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process AI request'
    });
  }
});

// AI-powered CSV file upload and parsing
app.post('/api/v1/ai/upload-csv', upload.single('file'), async (req, res) => {
  try {
    // Authenticate user
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'No token provided'
      });
    }

    const decoded = jsonwebtoken.verify(token, process.env.JWT_SECRET || 'default-secret');
    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid token'
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded'
      });
    }

    // Parse CSV using AI
    const csvContent = req.file.buffer.toString('utf-8');
    const parseResult = await parseCSVWithAI(csvContent, user.tenantId);

    res.json({
      success: true,
      data: parseResult
    });

  } catch (error) {
    console.error('CSV upload error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process CSV file'
    });
  }
});

// AI-powered bulk DID operations
app.post('/api/v1/ai/bulk-operation', async (req, res) => {
  try {
    // Authenticate user
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'No token provided'
      });
    }

    const decoded = jsonwebtoken.verify(token, process.env.JWT_SECRET || 'default-secret');
    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid token'
      });
    }

    const { operation, criteria, dryRun = false } = req.body;
    if (!operation || !criteria) {
      return res.status(400).json({
        success: false,
        error: 'Operation and criteria are required'
      });
    }

    // Execute bulk operation using AI
    const result = await executeBulkOperation(operation, criteria, user.tenantId, dryRun);

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('Bulk operation error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to execute bulk operation'
    });
  }
});

// ============================================================================
// AI HELPER FUNCTIONS
// ============================================================================

async function processAIMessage(message, context, tenantId) {
  try {
    // Get current DID statistics for context
    const didStats = await DID.aggregate([
      { $match: { tenantId } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          active: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
          inactive: { $sum: { $cond: [{ $eq: ['$status', 'inactive'] }, 1, 0] } },
          avgReputation: { $avg: '$reputation.score' },
          lowReputation: { $sum: { $cond: [{ $lt: ['$reputation.score', 30] }, 1, 0] } }
        }
      }
    ]);

    const stats = didStats[0] || { total: 0, active: 0, inactive: 0, avgReputation: 0, lowReputation: 0 };

    // Prepare context for AI
    const systemContext = `You are a DID (phone number) management assistant. Current system stats:
- Total DIDs: ${stats.total}
- Active DIDs: ${stats.active}
- Inactive DIDs: ${stats.inactive}
- Average reputation score: ${Math.round(stats.avgReputation || 0)}%
- DIDs with low reputation (<30%): ${stats.lowReputation}

Available actions: load_csv, delete_bad_reputation, bulk_update_status, export_data, analyze_performance

User context: ${JSON.stringify(context || {})}`;

    // Call AI model
    const aiResponse = await callAIModel(systemContext, message);

    // Parse AI response for actions
    const actions = extractActionsFromResponse(aiResponse);

    return {
      response: aiResponse,
      actions: actions,
      data: { stats }
    };

  } catch (error) {
    console.error('Error processing AI message:', error);
    throw error;
  }
}

async function parseCSVWithAI(csvContent, tenantId) {
  try {
    // First 1000 characters for AI analysis
    const sampleContent = csvContent.substring(0, 1000);

    const prompt = `Analyze this CSV content and extract DID phone number data:

${sampleContent}

Return JSON with:
{
  "headers": ["column1", "column2", ...],
  "phoneNumberColumn": "column_name",
  "statusColumn": "column_name_or_null",
  "capacityColumn": "column_name_or_null",
  "rows": [
    {"phoneNumber": "+1234567890", "status": "active", "capacity": 100},
    ...
  ]
}

Phone numbers should be in E.164 format (+1xxxxxxxxxx). If status not provided, default to "active". If capacity not provided, default to 100.`;

    const aiResponse = await callAIModel('You are a CSV parsing assistant for DID management.', prompt);

    // Parse AI response
    let parsed;
    try {
      parsed = JSON.parse(aiResponse);
    } catch (e) {
      // Try to extract JSON from response
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('AI response not valid JSON');
      }
    }

    // Validate and sanitize parsed data
    const validRows = parsed.rows
      .filter(row => row.phoneNumber && /^\+1\d{10}$/.test(row.phoneNumber))
      .map(row => ({
        phoneNumber: row.phoneNumber,
        status: row.status || 'active',
        capacity: row.capacity || 100
      }));

    return {
      total: validRows.length,
      valid: validRows.length,
      headers: parsed.headers || [],
      phoneNumberColumn: parsed.phoneNumberColumn,
      rows: validRows
    };

  } catch (error) {
    console.error('Error parsing CSV with AI:', error);
    throw error;
  }
}

async function executeBulkOperation(operation, criteria, tenantId, dryRun = false) {
  try {
    let query = { tenantId };
    let result = { affected: 0, details: [] };

    // Build query based on criteria
    if (criteria.reputationThreshold) {
      query['reputation.score'] = { $lt: criteria.reputationThreshold };
    }
    if (criteria.status) {
      query.status = criteria.status;
    }
    if (criteria.lastUsedDays) {
      const date = new Date();
      date.setDate(date.getDate() - criteria.lastUsedDays);
      query['usage.lastUsed'] = { $lt: date };
    }

    switch (operation) {
      case 'delete_bad_reputation':
        const didsToDelete = await DID.find(query);
        result.affected = didsToDelete.length;
        result.details = didsToDelete.map(did => ({
          phoneNumber: did.phoneNumber,
          reputation: did.reputation?.score || 0
        }));

        if (!dryRun) {
          await DID.deleteMany(query);
        }
        break;

      case 'update_status':
        const didsToUpdate = await DID.find(query);
        result.affected = didsToUpdate.length;
        result.details = didsToUpdate.map(did => ({
          phoneNumber: did.phoneNumber,
          oldStatus: did.status,
          newStatus: criteria.newStatus
        }));

        if (!dryRun) {
          await DID.updateMany(query, { $set: { status: criteria.newStatus } });
        }
        break;

      case 'export':
        const didsToExport = await DID.find(query);
        result.affected = didsToExport.length;
        result.data = didsToExport.map(did => ({
          phoneNumber: did.phoneNumber,
          status: did.status,
          reputation: did.reputation?.score || 0,
          lastUsed: did.usage?.lastUsed || null,
          totalCalls: did.usage?.totalCalls || 0
        }));
        break;
    }

    return result;

  } catch (error) {
    console.error('Error executing bulk operation:', error);
    throw error;
  }
}

async function callAIModel(systemPrompt, userMessage) {
  try {
    const apiBase = process.env.OPENAI_COMPATIBLE_URL || 'http://71.241.245.11:41924/v1';
    const model = process.env.OPENAI_COMPATIBLE_MODEL || 'openai/gpt-oss-20b';
    const apiKey = process.env.OPENAI_COMPATIBLE_KEY || 'not-needed';

    const response = await fetch(`${apiBase}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        temperature: 0.1,
        max_tokens: 1000
      })
    });

    if (!response.ok) {
      throw new Error(`AI API error: ${response.status}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;

  } catch (error) {
    console.error('Error calling AI model:', error);
    throw error;
  }
}

function extractActionsFromResponse(aiResponse) {
  const actions = [];

  // Extract common action patterns from AI response
  if (aiResponse.includes('delete') && aiResponse.includes('reputation')) {
    actions.push({ type: 'delete_bad_reputation', suggested: true });
  }
  if (aiResponse.includes('upload') || aiResponse.includes('CSV')) {
    actions.push({ type: 'upload_csv', suggested: true });
  }
  if (aiResponse.includes('export')) {
    actions.push({ type: 'export_data', suggested: true });
  }

  return actions;
}

// Error handling middleware (must be last)
app.use(notFound);
app.use(errorHandler);

const server = app.listen(PORT, () => {
  console.log(`
🚀 DID Optimizer Server Started
================================
📍 Frontend: https://dids.amdy.io
🌍 API: https://endpoint.amdy.io/api/v1
🏥 Health: https://endpoint.amdy.io/api/health
🔧 Server Port: ${PORT}
🔐 Google OAuth: ${process.env.GOOGLE_CLIENT_ID ? 'Configured ✅' : 'Not configured ⚠️'}
📦 Environment: ${process.env.NODE_ENV || 'development'}
🔗 Frontend: Serving static build from ./frontend
================================
Available Routes:
  /           - Home page
  /login      - Login page
  /signup     - Signup page
  /dashboard  - Dashboard (requires auth)
  /settings   - Settings (requires auth)
================================
  `);

  // Start billing jobs
  startAllBillingJobs();
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n⏹️ SIGINT received: closing HTTP server');
  server.close(async () => {
    console.log('✅ HTTP server closed');
    try {
      await timescalePool.end();
      console.log('✅ TimescaleDB pool closed');
    } catch (err) {
      console.warn('⚠️ TimescaleDB pool close error:', err.message);
    }
    mongoose.connection.close(false, () => {
      console.log('✅ MongoDB connection closed');
      process.exit(0);
    });
  });
});

export default app;