const jwt = require('jsonwebtoken');
const { EventUser } = require('../models');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');

const eventAuthMiddleware = {
  protect: catchAsync(async (req, res, next) => {
    // 1) Getting token and check if it's there
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return next(new ApiError(401, 'You are not logged in! Please log in to get access.'));
    }

    // 2) Verification token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // 3) Check if user still exists
    const currentUser = await EventUser.findById(decoded.id);
    if (!currentUser) {
      return next(new ApiError(401, 'The user belonging to this token does no longer exist.'));
    }

    // 4) Check if user is active
    if (!currentUser.isActive) {
      return next(new ApiError(401, 'Your account has been deactivated.'));
    }

    // Grant access to protected route
    req.user = currentUser;
    next();
  }),

  // Optional authentication (for routes that work with or without auth)
  optionalAuth: catchAsync(async (req, res, next) => {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const currentUser = await EventUser.findById(decoded.id);
        if (currentUser && currentUser.isActive) {
          req.user = currentUser;
        }
      } catch (error) {
        // Invalid token, but continue without user
      }
    }

    next();
  })
};

module.exports = eventAuthMiddleware;
