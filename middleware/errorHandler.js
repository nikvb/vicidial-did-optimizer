/**
 * Async handler to wrap async route handlers
 * Eliminates need for try-catch in every route
 */
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * Create standardized error objects
 */
export const createError = {
  badRequest: (message = 'Bad Request') => {
    const error = new Error(message);
    error.statusCode = 400;
    return error;
  },

  unauthorized: (message = 'Unauthorized') => {
    const error = new Error(message);
    error.statusCode = 401;
    return error;
  },

  forbidden: (message = 'Forbidden') => {
    const error = new Error(message);
    error.statusCode = 403;
    return error;
  },

  notFound: (message = 'Not Found') => {
    const error = new Error(message);
    error.statusCode = 404;
    return error;
  },

  conflict: (message = 'Conflict') => {
    const error = new Error(message);
    error.statusCode = 409;
    return error;
  },

  internal: (message = 'Internal Server Error') => {
    const error = new Error(message);
    error.statusCode = 500;
    return error;
  }
};

/**
 * Global error handler middleware
 */
export const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  // Log error for debugging
  console.error('❌ Error:', {
    statusCode,
    message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    url: req.originalUrl,
    method: req.method
  });

  // Send error response
  res.status(statusCode).json({
    success: false,
    error: {
      message,
      statusCode,
      ...(err.details && { details: err.details }),
      ...(err.fullError && { fullError: err.fullError }),
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    },
    message // Also include at root level for easier access
  });
};

/**
 * 404 handler middleware
 */
export const notFound = (req, res) => {
  res.status(404).json({
    success: false,
    error: {
      message: 'Route not found',
      statusCode: 404,
      path: req.originalUrl
    }
  });
};
