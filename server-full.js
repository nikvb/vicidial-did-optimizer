import dotenv from 'dotenv';
dotenv.config();

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

// Get __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import routes - commented out until route files are created
// import authRoutes from './routes/auth.js';
// import userRoutes from './routes/users.js';
// import didRoutes from './routes/dids.js';
// import analyticsRoutes from './routes/analytics.js';
// import billingRoutes from './routes/billing.js';
import tenantRoutes from './temp_clone/routes/tenants.js';
// import dashboardRoutes from './routes/dashboard.js';

// Import middleware - commented out until middleware files are created
// import { errorHandler } from './middleware/errorHandler.js';
// import { notFound } from './middleware/notFound.js';

// Import passport configuration AFTER dotenv
// import './config/passport.js'; // Commented out - passport config included inline

// Import additional modules for VICIdial endpoint - commented out until created
// import { validateApiKey } from './middleware/auth.js';
// import DID from './models/DID.js';

// Simple API key validation middleware
const validateApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || apiKey !== process.env.API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};
// import Tenant from './models/Tenant.js'; // Commented out until model created

const app = express();
const PORT = process.env.PORT || 3000;

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/did-optimizer')
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => {
    console.error('❌ MongoDB connection error:', err);
    console.log('⚠️ Running without database connection...');
  });

// Define Mongoose models
let User, DID, CallRecord, AuditLog;

// Get or create User model
try {
  User = mongoose.model('User');
} catch (error) {
  User = mongoose.model('User', new mongoose.Schema({
    email: String,
    password: String,
    firstName: String,
    lastName: String,
    role: String,
    isActive: Boolean,
    isEmailVerified: Boolean,
    lastLogin: Date,
    tenant: String
  }));
}

// Get or create DID model
try {
  DID = mongoose.model('DID');
} catch (error) {
  DID = mongoose.model('DID', new mongoose.Schema({
    tenantId: String,
    phoneNumber: String,
    status: String,
    reputation: {
      score: Number,
      callVolume: Number,
      successRate: Number
    },
    lastUsed: Date,
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
  }));
}

// Get or create CallRecord model
try {
  CallRecord = mongoose.model('CallRecord');
} catch (error) {
  CallRecord = mongoose.model('CallRecord', new mongoose.Schema({
    didId: String,
    tenantId: String,
    callId: String,
    timestamp: Date,
    duration: Number,
    outcome: String,
    createdAt: { type: Date, default: Date.now }
  }));
}

// Get or create AuditLog model
try {
  AuditLog = mongoose.model('AuditLog');
} catch (error) {
  AuditLog = mongoose.model('AuditLog', new mongoose.Schema({
    tenantId: String,
    userId: String,
    action: String,
    resourceType: String,
    resourceId: String,
    timestamp: { type: Date, default: Date.now },
    metadata: Object
  }));
}

// AreaCodeLocation model for location data integration
let AreaCodeLocation;
try {
  AreaCodeLocation = mongoose.model('AreaCodeLocation');
} catch (error) {
  AreaCodeLocation = mongoose.model('AreaCodeLocation', new mongoose.Schema({
    areaCode: {
      type: String,
      required: true,
      index: true,
      maxlength: 3
    },
    city: {
      type: String,
      required: true,
      index: true,
      trim: true
    },
    state: {
      type: String,
      required: true,
      index: true,
      trim: true
    },
    country: {
      type: String,
      required: true,
      default: 'US',
      maxlength: 2
    },
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point'
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        required: true
      }
    }
  }, {
    timestamps: false,
    versionKey: false
  }));
}

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

    const allowedOrigins = ['https://dids.amdy.io', 'http://api3.amdy.io:3000', 'https://endpoint.amdy.io', 'http://localhost:3000'];
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error('Not allowed by CORS'), false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
// app.use(mongoSanitize()); // Commented out - incompatible with Express 5

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
  message: 'Too many requests from this IP, please try again later.'
});

app.use('/api/', limiter);

// VICIdial API endpoint (before session middleware)

// VICIdial API endpoint - bypasses session auth
app.get('/api/v1/dids/next', validateApiKey, async (req, res) => {
  console.log('🎯 VICIdial DID Next endpoint called');
  console.log('📊 Query params:', req.query);
  console.log('🏢 Tenant:', req.tenant?.name, 'ID:', req.tenant?._id);

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
    console.log('🔍 Searching for DIDs with query:');
    console.log('   Tenant ID:', req.tenant._id);
    console.log('   Status: active');

    // Enhanced Round-Robin Rotation Algorithm
    // Reload tenant to get latest rotation state
    const freshTenant = await Tenant.findById(req.tenant._id);
    console.log('🔍 Fresh tenant rotation state from DB:', freshTenant.rotationState);

    let rotationState = freshTenant.rotationState || {
      currentIndex: 0,
      lastReset: new Date(),
      usedDidsInCycle: []
    };

    // Initialize usedDidsInCycle as a Set for processing
    const usedDidsSet = new Set(rotationState.usedDidsInCycle || []);

    // Reset cycle if all DIDs have been used or it's been more than 24 hours
    const activeDids = await DID.countDocuments({ tenantId: req.tenant._id, status: 'active' });
    const goodReputationDids = await DID.countDocuments({
      tenantId: req.tenant._id,
      status: 'active',
      'reputation.score': { $gte: 50 }
    });
    const shouldResetCycle = usedDidsSet.size >= goodReputationDids ||
                            (new Date() - new Date(rotationState.lastReset)) > 24 * 60 * 60 * 1000;

    if (shouldResetCycle) {
      console.log('🔄 Resetting rotation cycle - starting fresh round');
      usedDidsSet.clear();
      rotationState.currentIndex = 0;
      rotationState.lastReset = new Date();
    }

    console.log('🎯 Rotation State:', {
      currentIndex: rotationState.currentIndex,
      usedInCycle: usedDidsSet.size,
      totalActive: activeDids,
      goodReputation: goodReputationDids
    });

    // Strategy 1: Round-robin through unused DIDs in current cycle with good reputation
    let query = {
      tenantId: req.tenant._id,
      status: 'active',
      'reputation.score': { $gte: 50 } // Only use DIDs with good reputation (50+ score)
    };

    // Exclude DIDs already used in this cycle
    if (usedDidsSet.size > 0) {
      query._id = { $nin: Array.from(usedDidsSet) };
    }

    console.log('🔄 Step 1: Round-robin through unused DIDs in cycle with good reputation');
    let did = await DID.findOne(query)
      .sort({ lastUsed: 1, createdAt: 1 })
      .skip(rotationState.currentIndex % Math.max(1, goodReputationDids));

    if (!did && usedDidsSet.size > 0) {
      // Strategy 2: If no unused DIDs in cycle, pick least recently used with good reputation
      console.log('🔄 Step 2: All DIDs used in cycle, picking least recently used with good reputation');
      query = {
        tenantId: req.tenant._id,
        status: 'active',
        'reputation.score': { $gte: 50 } // Only use DIDs with good reputation (50+ score)
      };
      did = await DID.findOne(query).sort({ lastUsed: 1, _id: 1 });

      // Reset the cycle
      usedDidsSet.clear();
      rotationState.currentIndex = 0;
    }

    if (!did) {
      // Strategy 3: Try good reputation DIDs first, then any active DID as last resort
      console.log('🔄 Step 3: Fallback - trying good reputation DIDs first');
      did = await DID.findOne({
        tenantId: req.tenant._id,
        status: 'active',
        'reputation.score': { $gte: 50 }
      }).sort({ 'reputation.score': -1, lastUsed: 1 });

      if (!did) {
        console.log('⚠️ Step 4: Last resort - using any active DID (even with bad reputation)');
        did = await DID.findOne({
          tenantId: req.tenant._id,
          status: 'active'
        }).sort({ 'reputation.score': -1, lastUsed: 1 });
      }
    }

    // Check total DIDs for this tenant
    const totalDids = await DID.countDocuments({ tenantId: req.tenant._id });

    console.log('📊 DID Statistics:');
    console.log('   Total DIDs for tenant:', totalDids);
    console.log('   Active DIDs for tenant:', activeDids);
    console.log('   Good reputation DIDs (≥50):', goodReputationDids);
    console.log('   Bad reputation DIDs (<50):', activeDids - goodReputationDids);

    console.log('🎯 DID Query Result:', did ? `Found: ${did.phoneNumber} (Last used: ${did.lastUsed}, Reputation: ${did.reputation?.score || 'Unknown'})` : 'No DID found');

    if (!did) {
      return res.json({
        success: true,
        did: {
          number: process.env.FALLBACK_DID || '+18005551234',
          is_fallback: true
        }
      });
    }

    // Update rotation state
    usedDidsSet.add(did._id.toString());
    rotationState.currentIndex = (rotationState.currentIndex + 1) % activeDids;

    // Save rotation state to tenant
    const newRotationState = {
      currentIndex: rotationState.currentIndex,
      lastReset: rotationState.lastReset,
      usedDidsInCycle: Array.from(usedDidsSet) // Convert Set to Array for MongoDB
    };
    console.log('💾 Saving rotation state to DB:', newRotationState);

    freshTenant.rotationState = newRotationState;
    await freshTenant.save();

    console.log('✅ Rotation state saved to DB successfully');

    // Update last used timestamp
    did.lastUsed = new Date();
    did.usageCount = (did.usageCount || 0) + 1;
    await did.save();

    console.log('✅ Rotation state updated:', {
      selectedDID: did.phoneNumber,
      newIndex: rotationState.currentIndex,
      usedInCycle: usedDidsSet.size,
      totalActive: activeDids
    });

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
    console.error('💥 VICIdial API error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

// API Routes - commented out until route files are created
// app.use('/api/v1/auth', authRoutes);
// app.use('/api/v1/users', userRoutes);
// app.use('/api/v1/dids', didRoutes);
// app.use('/api/v1/analytics', analyticsRoutes);
// app.use('/api/v1/billing', billingRoutes);
app.use('/api/v1/tenants', tenantRoutes);
// app.use('/api/v1/dashboard', dashboardRoutes);

// Google OAuth Configuration
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: "https://endpoint.amdy.io/api/v1/auth/google/callback"
}, async (accessToken, refreshToken, profile, done) => {
  try {
    // Here you would normally save/update user in database
    const user = {
      googleId: profile.id,
      name: profile.displayName,
      email: profile.emails[0].value,
      photo: profile.photos[0].value
    };
    return done(null, user);
  } catch (error) {
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
app.get('/api/v1/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

app.get('/api/v1/auth/google/callback',
  passport.authenticate('google', { failureRedirect: (process.env.FRONTEND_URL || 'https://dids.amdy.io') + '/login' }),
  (req, res) => {
    // Successful authentication
    // Generate JWT token for the user
    const token = jsonwebtoken.sign(
      {
        id: req.user.googleId,
        email: req.user.email,
        name: req.user.name
      },
      process.env.JWT_SECRET || 'default-secret',
      { expiresIn: '7d' }
    );

    // Set token in a cookie and redirect to dashboard
    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    // Redirect to frontend dashboard
    const frontendUrl = process.env.FRONTEND_URL || 'https://dids.amdy.io';
    res.redirect(`${frontendUrl}/dashboard`);
  }
);

app.get('/api/v1/auth/logout', (req, res) => {
  req.logout((err) => {
    if (err) { return res.status(500).json({ error: 'Logout failed' }); }
    const frontendUrl = process.env.FRONTEND_URL || 'https://dids.amdy.io';
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
        id: user._id,
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
          id: user._id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role
        }
      }
    });
  } catch (error) {
    console.error('Login error:', error);
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
          id: user._id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role
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
  console.log('Headers:', req.headers);
  try {
    // Get actual data from database
    const totalUsers = await User.countDocuments();
    const totalTenants = await User.distinct('tenant').then(tenants => tenants.filter(Boolean).length);

    // Get DID statistics from real database
    const totalDIDs = await DID.countDocuments();
    const activeDIDs = await DID.countDocuments({ status: 'active' });

    // Get today's calls
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const callsToday = await CallRecord.countDocuments({
      createdAt: { $gte: today }
    });

    // API calls could be same as calls for now
    const apiCalls = callsToday;
    const apiUsage = totalUsers * 100; // Simple calculation based on users

    // Calculate success rate from actual call records
    const totalCallsToday = await CallRecord.countDocuments({
      createdAt: { $gte: today }
    });
    const successfulCalls = await CallRecord.countDocuments({
      createdAt: { $gte: today },
      outcome: 'success'
    });
    const successRate = totalCallsToday > 0
      ? `${((successfulCalls / totalCallsToday) * 100).toFixed(1)}%`
      : '0%';

    const systemHealth = 'healthy';

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

        recentActivity: finalActivity
      }
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({ message: 'Failed to load dashboard stats' });
  }
});

// DID Management API Endpoints
app.get('/api/v1/dids', async (req, res) => {
  try {
    // Parse pagination parameters
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 25;
    const skip = (page - 1) * limit;
    const sortBy = req.query.sortBy || 'createdAt';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
    const search = req.query.search || '';

    // Build query
    let query = {};
    if (search) {
      query.phoneNumber = { $regex: search, $options: 'i' };
    }

    // Get total count for pagination
    const totalCount = await DID.countDocuments(query);

    // Get DIDs with pagination
    const sortObj = { [sortBy]: sortOrder };
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
        did.reputation.score * 100 : 0;

      // Extract area code and get location data
      const areaCode = did.phoneNumber ? did.phoneNumber.substring(2, 5) : '';
      const locationData = await getLocationByAreaCode(areaCode);

      return {
        id: skip + index + 1,
        number: did.phoneNumber || '',
        status: did.status || 'unknown',
        calls: callCount,
        lastUsed: did.lastUsed ? did.lastUsed.toISOString() : new Date().toISOString(),
        performance: Math.round(performance * 10) / 10,
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
        score: did.reputation?.score ? Math.round(did.reputation.score * 100) : 0,
        status: did.reputation?.reputationStatus || 'Unknown',
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
const DEV_SERVER_URL = 'http://localhost:3000';
const proxy = createProxyMiddleware({
  target: DEV_SERVER_URL,
  changeOrigin: true,
  ws: true, // Enable WebSocket proxying for hot reload
  logLevel: 'info',
  onError: (err, req, res) => {
    console.error('Proxy error:', err);
    res.status(500).send('Development server not available. Please ensure React dev server is running on port 3000.');
  }
});

// Only proxy non-API routes to the development server
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    return next();
  }
  proxy(req, res, next);
});

// All other routes return the React app - commented out for Express 5 compatibility
// Will be handled by separate frontend server on port 3000
// app.get('/*', (req, res, next) => {
//   // Don't serve React app for API routes
//   if (req.path.startsWith('/api')) {
//     return next();
//   }

//   const indexPath = path.join(frontendBuildPath, 'index.html');
//   res.sendFile(indexPath, (err) => {
//     if (err) {
//       console.error('Error serving index.html:', err);
//       res.status(404).json({
//         error: true,
//         message: 'Frontend not built. Please run: cd frontend && npm run build'
//       });
//     }
//   });
// });

// Error handling middleware (must be last)
// Middleware - commented out until middleware files are created
// app.use(notFound);
// app.use(errorHandler);

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
🔗 Frontend Proxy: ${DEV_SERVER_URL} (Development)
================================
Available Routes:
  /           - Home page
  /login      - Login page
  /signup     - Signup page
  /dashboard  - Dashboard (requires auth)
  /settings   - Settings (requires auth)
================================
  `);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n⏹️ SIGINT received: closing HTTP server');
  server.close(() => {
    console.log('✅ HTTP server closed');
    mongoose.connection.close(false, () => {
      console.log('✅ MongoDB connection closed');
      process.exit(0);
    });
  });
});

export default app;