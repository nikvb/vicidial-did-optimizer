import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';

// Middleware to verify JWT token
export const authenticate = async (req, res, next) => {
  try {
    console.log('🔐 AUTH MIDDLEWARE - Starting authentication');
    const authHeader = req.headers.authorization;
    console.log('🔐 AUTH MIDDLEWARE - Auth header:', authHeader ? 'Present' : 'Missing');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('🔐 AUTH MIDDLEWARE - No Bearer token found');
      return res.status(401).json({
        success: false,
        message: 'Access token required'
      });
    }

    const token = authHeader.split(' ')[1];
    console.log('🔐 AUTH MIDDLEWARE - Token extracted:', token.substring(0, 20) + '...');

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'default-secret');
    console.log('🔐 AUTH MIDDLEWARE - Token decoded successfully');

    // Handle both 'id' and 'userId' in the token
    const userId = decoded.userId || decoded.id;
    console.log('🔐 AUTH MIDDLEWARE - User ID from token:', userId);

    // Use mongoose from root node_modules (same as server-full.js)
    const User = mongoose.model('User');
    const user = await User.findById(userId)
      .populate('tenant')
      .select('-password');

    console.log('🔐 AUTH MIDDLEWARE - User found:', user ? user.email : 'NOT FOUND');
    console.log('🔐 AUTH MIDDLEWARE - User active:', user?.isActive);
    console.log('🔐 AUTH MIDDLEWARE - User tenant:', user?.tenant ? user.tenant._id : 'NO TENANT');

    if (!user || !user.isActive) {
      console.log('🔐 AUTH MIDDLEWARE - User not found or inactive');
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired token'
      });
    }

    // Check if email is verified
    if (!user.isEmailVerified) {
      console.log('🔐 AUTH MIDDLEWARE - Email not verified');
      return res.status(403).json({
        success: false,
        message: 'Email verification required. Please check your email and verify your account before accessing the dashboard.',
        requiresEmailVerification: true
      });
    }

    // Check if tenant is active
    if (!user.tenant || !user.tenant.isActive) {
      console.log('🔐 AUTH MIDDLEWARE - Tenant not found or inactive');
      return res.status(403).json({
        success: false,
        message: 'Account access is suspended'
      });
    }

    console.log('🔐 AUTH MIDDLEWARE - Authentication successful ✅');
    req.user = user;
    next();
  } catch (error) {
    console.log('🔐 AUTH MIDDLEWARE - Error occurred:', error.message);
    console.log('🔐 AUTH MIDDLEWARE - Error type:', error.name);
    console.log('🔐 AUTH MIDDLEWARE - Stack:', error.stack);

    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }

    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired'
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Authentication error'
    });
  }
};

// Middleware to check if user has admin role
export const requireAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }

  if (req.user.role !== 'ADMIN') {
    return res.status(403).json({
      success: false,
      message: 'Admin access required'
    });
  }

  next();
};

// Middleware to check if user has specific role
export const requireRole = (role) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    if (req.user.role !== role) {
      return res.status(403).json({
        success: false,
        message: `${role} access required`
      });
    }

    next();
  };
};

// Middleware to check if user has client role or higher
export const requireClient = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }

  if (!['CLIENT', 'ADMIN'].includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      message: 'Insufficient permissions'
    });
  }

  next();
};

// Middleware to check subscription status
export const requireActiveSubscription = async (req, res, next) => {
  try {
    if (!req.user || !req.user.tenant) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const Tenant = mongoose.model('Tenant');
    const tenant = await Tenant.findById(req.user.tenant._id);

    if (!tenant || !tenant.isSubscriptionActive()) {
      return res.status(403).json({
        success: false,
        message: 'Active subscription required'
      });
    }

    req.tenant = tenant;
    next();
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Subscription check failed'
    });
  }
};

// Middleware to validate API key
export const validateApiKey = async (req, res, next) => {
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
    const Tenant = mongoose.model('Tenant');
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

// Middleware to check API permissions
export const requireApiPermission = (permission) => {
  return (req, res, next) => {
    if (!req.apiKey) {
      return res.status(401).json({
        success: false,
        message: 'API authentication required'
      });
    }

    if (!req.apiKey.permissions.includes(permission) && !req.apiKey.permissions.includes('admin')) {
      return res.status(403).json({
        success: false,
        message: `API permission '${permission}' required`
      });
    }

    next();
  };
};

// Middleware to validate tenant context
export const validateTenantContext = (req, res, next) => {
  const tenantId = req.params.tenantId || req.query.tenantId;

  if (tenantId && req.user) {
    // For regular users, ensure they can only access their own tenant
    if (req.user.role !== 'ADMIN' && req.user.tenant._id.toString() !== tenantId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied to this tenant'
      });
    }
  }

  next();
};

// Optional authentication middleware (doesn't fail if no token)
export const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'default-secret');

    // Handle both 'id' and 'userId' in the token
    const userId = decoded.userId || decoded.id;

    const User = mongoose.model('User');
    const user = await User.findById(userId)
      .populate('tenant')
      .select('-password');

    if (user && user.isActive && user.isEmailVerified && user.tenant && user.tenant.isActive) {
      req.user = user;
    }

    next();
  } catch (error) {
    // Ignore authentication errors for optional auth
    next();
  }
};
