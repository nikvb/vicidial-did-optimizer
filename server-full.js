import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import mongoSanitize from 'express-mongo-sanitize';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import mongoose from 'mongoose';
import passport from 'passport';
import path from 'path';
import { fileURLToPath } from 'url';

// Get __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import routes
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import didRoutes from './routes/dids.js';
import analyticsRoutes from './routes/analytics.js';
import billingRoutes from './routes/billing.js';
import tenantRoutes from './routes/tenants.js';

// Import middleware
import { errorHandler } from './middleware/errorHandler.js';
import { notFound } from './middleware/notFound.js';

// Import passport configuration AFTER dotenv
import './config/passport.js';

// Import additional modules for VICIdial endpoint
import { validateApiKey } from './middleware/auth.js';
import DID from './models/DID.js';
import Tenant from './models/Tenant.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/did-optimizer')
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => {
    console.error('❌ MongoDB connection error:', err);
    console.log('⚠️ Running without database connection...');
  });

// Trust proxy (for deployment behind reverse proxy)
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

// Enable CORS
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://api3.amdy.io:3000',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(mongoSanitize());

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-session-secret',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI || 'mongodb://localhost:27017/did-optimizer',
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
  windowMs: process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000,
  max: process.env.RATE_LIMIT_MAX_REQUESTS || 100,
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
    const shouldResetCycle = usedDidsSet.size >= activeDids ||
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
      totalActive: activeDids
    });

    // Strategy 1: Round-robin through unused DIDs in current cycle
    let query = {
      tenantId: req.tenant._id,
      status: 'active'
    };

    // Exclude DIDs already used in this cycle
    if (usedDidsSet.size > 0) {
      query._id = { $nin: Array.from(usedDidsSet) };
    }

    console.log('🔄 Step 1: Round-robin through unused DIDs in cycle');
    let did = await DID.findOne(query)
      .sort({ lastUsed: 1, createdAt: 1 })
      .skip(rotationState.currentIndex % activeDids);

    if (!did && usedDidsSet.size > 0) {
      // Strategy 2: If no unused DIDs in cycle, pick least recently used
      console.log('🔄 Step 2: All DIDs used in cycle, picking least recently used');
      query = {
        tenantId: req.tenant._id,
        status: 'active'
      };
      did = await DID.findOne(query).sort({ lastUsed: 1, _id: 1 });

      // Reset the cycle
      usedDidsSet.clear();
      rotationState.currentIndex = 0;
    }

    if (!did) {
      // Strategy 3: Fallback to any active DID
      console.log('🔄 Step 3: Fallback to any active DID');
      did = await DID.findOne({
        tenantId: req.tenant._id,
        status: 'active'
      }).sort({ _id: 1 });
    }

    // Check total DIDs for this tenant
    const totalDids = await DID.countDocuments({ tenantId: req.tenant._id });

    console.log('📊 DID Statistics:');
    console.log('   Total DIDs for tenant:', totalDids);
    console.log('   Active DIDs for tenant:', activeDids);

    console.log('🎯 DID Query Result:', did ? `Found: ${did.phoneNumber} (Last used: ${did.lastUsed})` : 'No DID found');

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

// API Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/dids', didRoutes);
app.use('/api/v1/analytics', analyticsRoutes);
app.use('/api/v1/billing', billingRoutes);
app.use('/api/v1/tenants', tenantRoutes);

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

// Serve static files from React build
const frontendBuildPath = path.join(__dirname, 'frontend', 'build');
app.use(express.static(frontendBuildPath));

// All other routes return the React app
app.get('*', (req, res, next) => {
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

// Error handling middleware (must be last)
app.use(notFound);
app.use(errorHandler);

const server = app.listen(PORT, () => {
  console.log(`
🚀 DID Optimizer Server Started
================================
📍 Frontend: http://localhost:${PORT}
🌍 API: http://localhost:${PORT}/api/v1
🏥 Health: http://localhost:${PORT}/api/health
🔐 Google OAuth: ${process.env.GOOGLE_CLIENT_ID ? 'Configured ✅' : 'Not configured ⚠️'}
📦 Environment: ${process.env.NODE_ENV || 'development'}
📂 Frontend Build: ${frontendBuildPath}
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