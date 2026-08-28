const express = require('express');
// eslint-disable-next-line no-unused-vars
const auth = require('../../middlewares/auth');
// const validate = require('../../middlewares/validate');
// const userValidation = require('../../validations/user.validation');
const studentController = require('../../controllers/students.controller');
const { legacyGate, denySubAgent } = require('../../middlewares/subAgentScope');

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

router.route('/student-dashboard-data').get(legacyGate, denySubAgent, studentController.getDashboardStudentData);
router.route('/counselor-leaderboard').get(legacyGate, denySubAgent, studentController.getCounselorLeaderboard);

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
router.route('/search/:text').get(legacyGate, denySubAgent, studentController.searchStudents);

module.exports = router;
