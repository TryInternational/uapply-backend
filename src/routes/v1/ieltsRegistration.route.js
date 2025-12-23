const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, param, query, validationResult } = require('express-validator');
const ieltsRegistrationController = require('../../controllers/ieltsRegistration.controller');
const auth = require('../../middlewares/auth');

const router = express.Router();

// Rate limiting for registration endpoints
const registrationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 3, // limit each IP to 3 registrations per windowMs
  message: {
    success: false,
    message: 'Too many registration attempts, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Validation schemas
const createRegistrationValidation = [
  body('name')
    .notEmpty()
    .withMessage('Name is required')
    .isLength({ min: 2, max: 100 })
    .withMessage('Name must be between 2 and 100 characters'),
  
  body('age')
    .notEmpty()
    .withMessage('Age is required'),
  
  body('phoneNumber')
    .matches(/^[+]?[0-9]{8,15}$/)
    .withMessage('Phone number must be 8-15 digits and may include a + prefix'),
  
  body('email')
    .isEmail()
    .withMessage('Valid email is required')
    .normalizeEmail(),
  
  body('nationality')
    .notEmpty()
    .withMessage('Nationality is required'),
  
  body('studyDestination')
    .isIn(['uk', 'other'])
    .withMessage('Study destination must be either "uk" or "other"'),
  
  body('previousIELTS')
    .isIn(['yes', 'no'])
    .withMessage('Previous IELTS must be either "yes" or "no"'),
  
  body('englishLevel')
    .isIn(['weak', 'average', 'excellent'])
    .withMessage('English level must be "weak", "average", or "excellent"'),
  
  body('fieldOfStudy')
    .notEmpty()
    .withMessage('Field of study is required'),
  
  body('registrationTime')
    .optional()
    .isString()
    .withMessage('Registration time must be a string'),
  
  body('guests')
    .optional()
    .isArray()
    .withMessage('Guests must be an array'),
  
  body('guests.*.name')
    .optional()
    .isLength({ min: 2, max: 100 })
    .withMessage('Guest name must be between 2 and 100 characters'),
  
  body('guests.*.email')
    .optional()
    .isEmail()
    .withMessage('Guest email must be valid'),
  
  body('guests.*.phone')
    .optional()
    .matches(/^[+]?[0-9]{8,15}$/)
    .withMessage('Guest phone number must be 8-15 digits')
];

const updateStatusValidation = [
  param('id')
    .isMongoId()
    .withMessage('Invalid registration ID'),
  
  body('status')
    .isIn(['pending', 'confirmed', 'cancelled'])
    .withMessage('Status must be pending, confirmed, or cancelled'),
  
  body('notes')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Notes cannot exceed 500 characters')
];

const confirmationCodeValidation = [
  param('confirmationCode')
    .matches(/^IELTS-\d+-[A-Z0-9]+$/)
    .withMessage('Invalid confirmation code format')
];

const emailValidation = [
  param('email')
    .isEmail()
    .withMessage('Valid email is required')
];

const mongoIdValidation = [
  param('id')
    .isMongoId()
    .withMessage('Invalid ID format')
];

const paginationValidation = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  
  query('sortBy')
    .optional()
    .isIn(['registrationDate', 'name', 'email', 'status'])
    .withMessage('Invalid sort field'),
  
  query('sortOrder')
    .optional()
    .isIn(['asc', 'desc'])
    .withMessage('Sort order must be asc or desc')
];

// Validation error handler
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const errorMessages = errors.array().map(error => ({
      field: error.param,
      message: error.msg,
      value: error.value
    }));
    
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errorMessages
    });
  }
  next();
};

// Public routes
router.post('/',
  registrationLimiter,
  createRegistrationValidation,
  handleValidationErrors,
  ieltsRegistrationController.createRegistration
);

router.get('/confirmation/:confirmationCode',
  confirmationCodeValidation,
  handleValidationErrors,
  ieltsRegistrationController.getRegistrationByCode
);

router.get('/email/:email',
  emailValidation,
  handleValidationErrors,
  ieltsRegistrationController.getRegistrationByEmail
);

router.get('/available-seats',
  ieltsRegistrationController.getAvailableSeats
);
router.get('/',
  paginationValidation,
  handleValidationErrors,
  ieltsRegistrationController.getAllRegistrations
);
// Protected routes (Admin only)
router.use(auth('admin'));



router.get('/stats',
  ieltsRegistrationController.getRegistrationStats
);

router.put('/:id/status',
  updateStatusValidation,
  handleValidationErrors,
  ieltsRegistrationController.updateRegistrationStatus
);

router.post('/:id/retry-sync',
  mongoIdValidation,
  handleValidationErrors,
  ieltsRegistrationController.retrySheetsSync
);

module.exports = router;
