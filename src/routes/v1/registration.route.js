const express = require('express');
const rateLimit = require('express-rate-limit');
const { registrationController } = require('../../controllers');
const eventAuthMiddleware = require('../../middlewares/eventAuth');
const { registrationValidation, paramValidation, queryValidation, handleValidationErrors } = require('../../middlewares/eventValidation');
const { authorize } = require('../../middlewares/eventAuthorize');

const router = express.Router();

// Rate limiting for registration endpoints
const registrationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 requests per windowMs
  message: {
    success: false,
    message: 'Too many registration attempts, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Public routes
router.post('/events/:eventId/register',
  registrationLimiter,
  paramValidation.eventId,
  registrationValidation.create,
  handleValidationErrors,
  registrationController.registerForEvent
);

router.get('/:confirmationCode',
  paramValidation.confirmationCode,
  handleValidationErrors,
  registrationController.getRegistrationByCode
);

router.put('/:id/cancel',
  paramValidation.mongoId,
  handleValidationErrors,
  registrationController.cancelRegistration
);

router.get('/user/:email',
  queryValidation.pagination,
  handleValidationErrors,
  registrationController.getUserRegistrations
);

// Protected routes (Admin/Staff only)
router.use(eventAuthMiddleware.protect);

router.get('/',
  authorize(['admin', 'staff']),
  queryValidation.pagination,
  handleValidationErrors,
  registrationController.getAllRegistrations
);

router.put('/:id/status',
  authorize(['admin', 'staff']),
  paramValidation.mongoId,
  registrationValidation.updateStatus,
  handleValidationErrors,
  registrationController.updateRegistrationStatus
);

router.post('/:id/resend-confirmation',
  authorize(['admin', 'staff']),
  paramValidation.mongoId,
  handleValidationErrors,
  registrationController.resendConfirmation
);

module.exports = router;
