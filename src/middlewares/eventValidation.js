const { body, param, query, validationResult } = require('express-validator');
const ApiError = require('../utils/ApiError');

// Event validation rules
const eventValidation = {
  create: [
    body('title').notEmpty().trim().isLength({ min: 3, max: 100 })
      .withMessage('Title must be between 3 and 100 characters'),
    body('type').isIn(['IELTS', 'CONSULTATION', 'WORKSHOP', 'SEMINAR'])
      .withMessage('Type must be one of: IELTS, CONSULTATION, WORKSHOP, SEMINAR'),
    body('date').isISO8601().custom(value => {
      if (new Date(value) <= new Date()) {
        throw new Error('Event date must be in the future');
      }
      return true;
    }),
    body('startTime').matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)
      .withMessage('Start time must be in HH:MM format'),
    body('endTime').matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)
      .withMessage('End time must be in HH:MM format'),
    body('location').notEmpty().trim().isLength({ min: 3, max: 200 })
      .withMessage('Location must be between 3 and 200 characters'),
    body('totalSeats').isInt({ min: 1, max: 1000 })
      .withMessage('Total seats must be between 1 and 1000'),
    body('price').optional().isFloat({ min: 0 })
      .withMessage('Price must be a positive number'),
    body('currency').optional().isIn(['KWD', 'USD', 'EUR'])
      .withMessage('Currency must be one of: KWD, USD, EUR'),
    body('instructor.name').optional().trim().isLength({ min: 2, max: 50 })
      .withMessage('Instructor name must be between 2 and 50 characters'),
    body('instructor.email').optional().isEmail()
      .withMessage('Instructor email must be valid'),
    body('requirements').optional().isArray()
      .withMessage('Requirements must be an array'),
    body('tags').optional().isArray()
      .withMessage('Tags must be an array')
  ],
  
  update: [
    body('title').optional().trim().isLength({ min: 3, max: 100 })
      .withMessage('Title must be between 3 and 100 characters'),
    body('type').optional().isIn(['IELTS', 'CONSULTATION', 'WORKSHOP', 'SEMINAR'])
      .withMessage('Type must be one of: IELTS, CONSULTATION, WORKSHOP, SEMINAR'),
    body('date').optional().isISO8601().custom(value => {
      if (new Date(value) <= new Date()) {
        throw new Error('Event date must be in the future');
      }
      return true;
    }),
    body('startTime').optional().matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)
      .withMessage('Start time must be in HH:MM format'),
    body('endTime').optional().matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)
      .withMessage('End time must be in HH:MM format'),
    body('totalSeats').optional().isInt({ min: 1, max: 1000 })
      .withMessage('Total seats must be between 1 and 1000'),
    body('price').optional().isFloat({ min: 0 })
      .withMessage('Price must be a positive number'),
    body('status').optional().isIn(['active', 'cancelled', 'completed', 'draft'])
      .withMessage('Status must be one of: active, cancelled, completed, draft')
  ]
};

// Registration validation rules
const registrationValidation = {
  create: [
    body('fullName').notEmpty().trim().isLength({ min: 2, max: 50 })
      .withMessage('Full name must be between 2 and 50 characters'),
    body('email').isEmail().normalizeEmail()
      .withMessage('Please provide a valid email address'),
    body('phone').matches(/^[+]?[0-9]{8,15}$/)
      .withMessage('Phone number must be 8-15 digits and may include a + prefix'),
    body('nationality').notEmpty().trim().isLength({ min: 2, max: 50 })
      .withMessage('Nationality is required'),
    body('englishLevel').isIn(['beginner', 'elementary', 'intermediate', 'upper-intermediate', 'advanced'])
      .withMessage('English level must be one of: beginner, elementary, intermediate, upper-intermediate, advanced'),
    body('previousIELTS').isIn(['yes', 'no'])
      .withMessage('Previous IELTS must be yes or no'),
    body('previousScore').optional().trim().isLength({ max: 10 })
      .withMessage('Previous score must be a string and cannot exceed 10 characters'),
    body('specialRequests').optional().isLength({ max: 500 })
      .withMessage('Special requests cannot exceed 500 characters'),
    // UTM data validation (optional)
    body('utmSource').optional().trim().isLength({ max: 100 })
      .withMessage('UTM source cannot exceed 100 characters'),
    body('utmMedium').optional().trim().isLength({ max: 100 })
      .withMessage('UTM medium cannot exceed 100 characters'),
    body('utmCampaign').optional().trim().isLength({ max: 100 })
      .withMessage('UTM campaign cannot exceed 100 characters')
  ],

  updateStatus: [
    body('status').isIn(['confirmed', 'pending', 'cancelled', 'attended', 'no-show'])
      .withMessage('Status must be one of: confirmed, pending, cancelled, attended, no-show'),
    body('notes').optional().isLength({ max: 500 })
      .withMessage('Notes cannot exceed 500 characters')
  ]
};

// Auth validation rules
const authValidation = {
  login: [
    body('email').isEmail().normalizeEmail()
      .withMessage('Please provide a valid email address'),
    body('password').notEmpty()
      .withMessage('Password is required')
  ],

  register: [
    body('name').notEmpty().trim().isLength({ min: 2, max: 50 })
      .withMessage('Name must be between 2 and 50 characters'),
    body('email').isEmail().normalizeEmail()
      .withMessage('Please provide a valid email address'),
    body('password').isLength({ min: 6 })
      .withMessage('Password must be at least 6 characters long'),
    body('role').isIn(['admin', 'staff', 'instructor'])
      .withMessage('Role must be one of: admin, staff, instructor'),
    body('permissions').optional().isArray()
      .withMessage('Permissions must be an array'),
    body('permissions.*').optional().isIn(['create_events', 'edit_events', 'delete_events', 'view_registrations', 'manage_users'])
      .withMessage('Invalid permission value')
  ],

  changePassword: [
    body('currentPassword').notEmpty()
      .withMessage('Current password is required'),
    body('newPassword').isLength({ min: 6 })
      .withMessage('New password must be at least 6 characters long')
  ]
};

// Parameter validation
const paramValidation = {
  mongoId: [
    param('id').isMongoId()
      .withMessage('Invalid ID format'),
  ],
  
  eventId: [
    param('eventId').isMongoId()
      .withMessage('Invalid event ID format'),
  ],

  confirmationCode: [
    param('confirmationCode').matches(/^REG-\d+-[A-Z0-9]+$/)
      .withMessage('Invalid confirmation code format')
  ]
};

// Query validation
const queryValidation = {
  pagination: [
    query('page').optional().isInt({ min: 1 })
      .withMessage('Page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 100 })
      .withMessage('Limit must be between 1 and 100'),
  ],

  eventFilters: [
    query('type').optional().isIn(['IELTS', 'CONSULTATION', 'WORKSHOP', 'SEMINAR'])
      .withMessage('Type must be one of: IELTS, CONSULTATION, WORKSHOP, SEMINAR'),
    query('status').optional().isIn(['active', 'cancelled', 'completed', 'draft'])
      .withMessage('Status must be one of: active, cancelled, completed, draft'),
    query('upcoming').optional().isBoolean()
      .withMessage('Upcoming must be true or false'),
    query('sortBy').optional().isIn(['date', 'title', 'createdAt', 'totalSeats'])
      .withMessage('Sort by must be one of: date, title, createdAt, totalSeats'),
    query('sortOrder').optional().isIn(['asc', 'desc'])
      .withMessage('Sort order must be asc or desc')
  ]
};

// Validation error handler
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const errorMessages = errors.array().map(error => ({
      field: error.param,
      message: error.msg,
      value: error.value
    }));
    
    return next(new ApiError(400, 'Validation failed', errorMessages));
  }
  next();
};

module.exports = {
  eventValidation,
  registrationValidation,
  authValidation,
  paramValidation,
  queryValidation,
  handleValidationErrors
};
