const express = require('express');
const { eventController } = require('../../controllers');
const eventAuthMiddleware = require('../../middlewares/eventAuth');
const { eventValidation, paramValidation, queryValidation, handleValidationErrors } = require('../../middlewares/eventValidation');
const { authorize, checkPermission } = require('../../middlewares/eventAuthorize');

const router = express.Router();

// Public routes
router.get('/', 
  queryValidation.pagination,
  queryValidation.eventFilters,
  handleValidationErrors,
  eventController.getEvents
);

router.get('/:id', 
  paramValidation.mongoId,
  handleValidationErrors,
  eventController.getEvent
);

// Protected routes (require authentication)
router.use(eventAuthMiddleware.protect);

// Admin/Staff only routes
router.post('/', 
  authorize(['admin', 'staff']),
  eventValidation.create,
  handleValidationErrors,
  eventController.createEvent
);

router.put('/:id',
  authorize(['admin', 'staff']),
  paramValidation.mongoId,
  eventValidation.update,
  handleValidationErrors,
  eventController.updateEvent
);

router.delete('/:id',
  authorize(['admin']),
  paramValidation.mongoId,
  handleValidationErrors,
  eventController.deleteEvent
);

router.get('/:id/stats',
  authorize(['admin', 'staff']),
  paramValidation.mongoId,
  handleValidationErrors,
  eventController.getEventStats
);

router.get('/:id/registrations',
  authorize(['admin', 'staff']),
  paramValidation.mongoId,
  queryValidation.pagination,
  handleValidationErrors,
  eventController.getEventRegistrations
);

module.exports = router;
