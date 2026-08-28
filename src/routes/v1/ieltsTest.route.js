const express = require('express');
const auth = require('../../middlewares/auth');
const ieltsTestController = require('../../controllers/ieltsTest.controller');
const { optionalUlearnStudentAuth } = require('../../middlewares/ulearnStudentAuth');

const router = express.Router();

// Public routes (no authentication required)
router.route('/eligibility').post(ieltsTestController.checkTestEligibility);
// AI writing scorer (frontend constant IELTS_EVALUATE_WRITING) — this is the
// endpoint staging/production builds call; dev runs the same logic in CRA
router.route('/evaluate-writing').post(ieltsTestController.evaluateWriting);

// Protected routes (require authentication)
// router.use(auth());

// Main IELTS test routes
// optionalUlearnStudentAuth: links the attempt to a signed-in ulearn student
// when a valid Bearer token is present; anonymous submissions work unchanged.
router
  .route('/')
  .post(optionalUlearnStudentAuth(), ieltsTestController.createIELTSTest)
  .get(ieltsTestController.getIELTSTests);

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
