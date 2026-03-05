const express = require('express');
const auth = require('../../middlewares/auth');
const ieltsTestController = require('../../controllers/ieltsTest.controller');

const router = express.Router();

// Public routes (no authentication required)
router.route('/eligibility').post(ieltsTestController.checkTestEligibility);

// Protected routes (require authentication)
// router.use(auth());

// Main IELTS test routes
router.route('/').post(ieltsTestController.createIELTSTest).get(ieltsTestController.getIELTSTests);

// Search route
router.route('/search/:text').get(ieltsTestController.searchIELTSTests);

// Statistics and analytics routes
router.route('/statistics').get(ieltsTestController.getTestStatistics);
router.route('/dashboard').get(ieltsTestController.getIELTSDashboardData);

// Export route
router.route('/export').get(ieltsTestController.exportTestResults);

// User-specific routes
router.route('/history/:phone').get(ieltsTestController.getUserTestHistory);
router.route('/stats/:phone').get(ieltsTestController.getUserTestStats);
router.route('/latest/:phone').get(ieltsTestController.getLatestIELTSTestByPhone);

// Admin-only routes
router.route('/reset-attempts/:phone').post(ieltsTestController.resetUserAttempts);

// Single test operations
router
  .route('/:testId')
  .get(ieltsTestController.getIELTSTest)
  .patch(ieltsTestController.updateIELTSTest)
  .delete(ieltsTestController.deleteIELTSTest);

// WhatsApp operations
router.route('/:testId/send-whatsapp').post(ieltsTestController.sendWhatsAppResults);

module.exports = router;
