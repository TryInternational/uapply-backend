const express = require('express');
const { analyticsController } = require('../../controllers');
const eventAuthMiddleware = require('../../middlewares/eventAuth');
const { paramValidation, queryValidation, handleValidationErrors } = require('../../middlewares/eventValidation');
const { authorize } = require('../../middlewares/eventAuthorize');

const router = express.Router();

// All analytics routes require authentication
router.use(eventAuthMiddleware.protect);

// Admin/Staff only routes
router.get('/dashboard',
  authorize(['admin', 'staff']),
  analyticsController.getDashboardStats
);

router.get('/events/:id',
  authorize(['admin', 'staff']),
  paramValidation.mongoId,
  handleValidationErrors,
  analyticsController.getEventAnalytics
);

router.get('/revenue',
  authorize(['admin', 'staff']),
  handleValidationErrors,
  analyticsController.getRevenueStats
);

router.get('/export',
  authorize(['admin']),
  queryValidation.pagination,
  handleValidationErrors,
  analyticsController.exportData
);

module.exports = router;
