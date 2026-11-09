const express = require('express');
const responseCache = require('../../middlewares/responseCache');
// eslint-disable-next-line no-unused-vars
const auth = require('../../middlewares/auth');
// const validate = require('../../middlewares/validate');
// const userValidation = require('../../validations/user.validation');
const studentController = require('../../controllers/students.controller');
const { legacyGate, denySubAgent } = require('../../middlewares/subAgentScope');
const dashboardBreakdownsController = require('../../controllers/dashboardBreakdowns.controller');

const router = express.Router();

/**
 * `legacyGate` is APPLICATION_AUTH-controlled (see middlewares/subAgentScope.js).
 * Off by default -- these routes have never required a token -- but it still
 * populates req.user when one is presented, which is what lets the controllers
 * scope a sub-agent to its own students. `denySubAgent` closes the routes a
 * sub-agent must never reach even while the flag is off.
 */
router.route('/').post(legacyGate, studentController.createStudent).get(legacyGate, studentController.getStudents);
router.route('/months').get(legacyGate, denySubAgent, studentController.getStudentsByMonths);
router.route('/top-nationalities').get(legacyGate, denySubAgent, studentController.getTopStudentsByNationality);
router.route('/count').get(legacyGate, denySubAgent, studentController.getStudentCountByAssignedRole);
router.route('/facets').get(legacyGate, denySubAgent, responseCache(5 * 60 * 1000), studentController.getStudentFacets);
router.route('/counts-by-user').get(legacyGate, denySubAgent, studentController.getStudentCountsByUser);

router
  .route('/student-dashboard-data')
  .get(legacyGate, denySubAgent, responseCache(), studentController.getDashboardStudentData);
router
  .route('/counselor-leaderboard')
  .get(legacyGate, denySubAgent, responseCache(), studentController.getCounselorLeaderboard);
// Stats tab breakdowns (per person, cities/schools/funding, courses, offer rate, lost reasons, speed)
router
  .route('/dashboard-breakdowns')
  .get(legacyGate, denySubAgent, responseCache(), dashboardBreakdownsController.getBreakdowns);

router
  .route('/:studentId')
  .get(legacyGate, studentController.getStudent)
  .patch(legacyGate, studentController.updateStudent)
  .delete(legacyGate, denySubAgent, studentController.deleteStudent);
router.route('/:studentId/share').post(legacyGate, denySubAgent, studentController.shareStudentWithCounselor);
// Returning student: close the current journey and open the next (stage rules
// live in the controller). NOT denySubAgent -- a partner starting a new
// journey for their own student is the point; the handler checks ownership.
router.route('/:studentId/new-journey').post(legacyGate, studentController.startNewJourney);
// Partner portal "Resubmit to Ulearn" / "Delete student" — a partner's PATCH
// cannot write `stage`, so these are their own routes (owner-only, checked in
// the handlers).
router.route('/:studentId/partner-resubmit').post(legacyGate, studentController.partnerResubmit);
router.route('/:studentId/partner-withdraw').post(legacyGate, studentController.partnerWithdraw);
router.route('/search/:text').get(legacyGate, denySubAgent, studentController.searchStudents);

module.exports = router;
