const express = require('express');

const applicationsController = require('../../controllers/application.controller');
const {
  legacyGate,
  requireAuth,
  denySubAgent,
  requireSubAgent,
  requireSchoolCounselor,
  requireReviewer,
} = require('../../middlewares/subAgentScope');

const router = express.Router();

/**
 * Two gates, on purpose (see middlewares/subAgentScope.js):
 *
 *   legacyGate  - the routes below that already existed. Controlled by
 *                 APPLICATION_AUTH, off by default. Off still IDENTIFIES a
 *                 caller that presents a valid token, which is what makes the
 *                 sub-agent scoping in the controllers work today; it just does
 *                 not reject callers that present none.
 *   requireAuth - the routes added by this feature. Always requires a token,
 *                 whatever the flag says.
 *
 * Route order matters: every literal path is mounted before '/:applicationId',
 * or Express would match 'mine' and 'pending-review' as an application id.
 */

// ---- sub-agent portal (always authenticated) ----
router.route('/mine').get(requireAuth, requireSubAgent, applicationsController.getMyApplications);
router.route('/:applicationId/resubmit').patch(requireAuth, requireSubAgent, applicationsController.resubmitApplication);

// ---- school-counsellor portal (always authenticated) ----
// Separate from /mine so the sub-agent route keeps its exact behaviour. A
// counsellor's applications are found through the STUDENTS they own, not
// through application.createdBy, because Ulearn staff may create applications
// for a referred student.
router
  .route('/mine-school')
  .get(requireAuth, requireSchoolCounselor, applicationsController.getMySchoolApplications);

// ---- counsellor review (always authenticated) ----
router.route('/pending-review').get(requireAuth, requireReviewer, applicationsController.getPendingReviewApplications);
router.route('/:applicationId/review').post(requireAuth, requireReviewer, applicationsController.reviewApplication);

// ---- pre-existing routes ----
// Creation is shared: staff create live applications, sub-agents create
// submissions awaiting review. The controller branches on the caller's role.
router.post('/', legacyGate, applicationsController.createApplication);

router.route('/').get(legacyGate, applicationsController.getApplications);

// Aggregate/reporting endpoints span every agent's data, so a sub-agent is
// refused outright rather than scoped.
router.route('/application-counts').get(legacyGate, denySubAgent, applicationsController.getApplicationsByPhase);
router.route('/application-counts-university').get(legacyGate, denySubAgent, applicationsController.getTopUniversities);
router
  .route('/application-enrolled-university')
  .get(legacyGate, denySubAgent, applicationsController.getEnrolledUniversities);
router.route('/application-dashboard-data').get(legacyGate, denySubAgent, applicationsController.getDashboardData);
router.route('/dashboard-drilldown').get(legacyGate, denySubAgent, applicationsController.getDashboardDrilldown);
router.route('/count-by-month').get(legacyGate, denySubAgent, applicationsController.getApplicationsCountByMonth);
router
  .route('/enrolled-count-by-month')
  .get(legacyGate, denySubAgent, applicationsController.getEnrolledApplicationsCountByMonth);

router
  .route('/:applicationId')
  .patch(legacyGate, denySubAgent, applicationsController.updateApplication)
  .delete(legacyGate, denySubAgent, applicationsController.deleteApplication);

router.route('/:applicationId').get(legacyGate, applicationsController.getApplication);
router.route('/student/:studentId').get(legacyGate, applicationsController.getApplicationByStudentId);

module.exports = router;
