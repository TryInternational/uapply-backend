const express = require('express');
const rateLimit = require('express-rate-limit');
const { eventAuthController } = require('../../controllers');
const eventAuthMiddleware = require('../../middlewares/eventAuth');
const { authValidation, paramValidation, queryValidation, handleValidationErrors } = require('../../middlewares/eventValidation');
const { authorize } = require('../../middlewares/eventAuthorize');

const router = express.Router();

// Rate limiting for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 requests per windowMs
  message: {
    success: false,
    message: 'Too many authentication attempts, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Public routes
router.post('/login',
  authLimiter,
  authValidation.login,
  handleValidationErrors,
  eventAuthController.login
);

// Protected routes
router.use(eventAuthMiddleware.protect);

router.get('/me', 
  eventAuthController.getProfile
);

router.post('/change-password',
  authValidation.changePassword,
  handleValidationErrors,
  eventAuthController.changePassword
);

// Admin only routes
router.post('/register',
  authorize(['admin']),
  authValidation.register,
  handleValidationErrors,
  eventAuthController.register
);

router.get('/users',
  authorize(['admin']),
  queryValidation.pagination,
  handleValidationErrors,
  eventAuthController.getUsers
);

router.put('/users/:id',
  authorize(['admin']),
  paramValidation.mongoId,
  handleValidationErrors,
  eventAuthController.updateUser
);

router.delete('/users/:id',
  authorize(['admin']),
  paramValidation.mongoId,
  handleValidationErrors,
  eventAuthController.deleteUser
);

module.exports = router;
