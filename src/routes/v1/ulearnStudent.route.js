const express = require('express');
const ulearnStudentController = require('../../controllers/ulearnStudent.controller');
const { ulearnStudentAuth } = require('../../middlewares/ulearnStudentAuth');
const auth = require('../../middlewares/auth');
const config = require('../../config/config');

const router = express.Router();

/**
 * The back-office gate, off by default.
 *
 * These were the only auth()-gated routes in this service — leads, students,
 * majors, aptitude, IELTS and users are all open — so the CRM had never needed
 * a working token here. Worse, the CRM never calls /auth/refresh-tokens and
 * access tokens expire after 30 minutes, so a gated route fails with
 * TokenExpiredError twice an hour for every counsellor.
 *
 * Set ULEARN_BACKOFFICE_AUTH=true to require a back-office JWT again — worth
 * doing once the CRM refreshes its token, and ideally at the same time as the
 * sibling routes, since this data (names, phone numbers, results) is no more
 * or less sensitive than the leads sitting open beside it.
 */
const backOfficeGate = config.ulearnStudents.backOfficeAuth
  ? auth('getUsers')
  : (req, res, next) => next();

// Phone sign-in (primary): verifies the Firebase ID token server-side, upserts
// the student on the verified phone identity, claims historical attempts, and
// returns the service JWT.
router.post('/auth/phone', ulearnStudentController.phoneAuth);

// Google sign-in (legacy): kept mounted so a rollback is an env flag, not a
// redeploy. Returns 503 unless ULEARN_GOOGLE_AUTH_ENABLED is true.
router.post('/auth/google', ulearnStudentController.googleAuth);

// ── back office (uapply-crm) ──
// Gated by the BACK-OFFICE auth: passport JWT against the User model plus the
// role rights check. Deliberately NOT ulearnStudentAuth — a student token must
// never reach these, or one student could read another's attempts.
router.get('/back-office/students', backOfficeGate, ulearnStudentController.listStudentsForBackOffice);
router.get(
  '/back-office/students/:studentId/tests',
  backOfficeGate,
  ulearnStudentController.getStudentTestsForBackOffice
);
router.patch(
  '/back-office/students/:studentId',
  backOfficeGate,
  ulearnStudentController.updateStudentFromBackOffice
);

// authenticated student endpoints
router.get('/me', ulearnStudentAuth(), ulearnStudentController.getMe);
router.patch('/me', ulearnStudentAuth(), ulearnStudentController.updateMe);
router.get('/me/tests', ulearnStudentAuth(), ulearnStudentController.getMyTests);
router.get('/me/progress', ulearnStudentAuth(), ulearnStudentController.getMyProgress);

module.exports = router;
