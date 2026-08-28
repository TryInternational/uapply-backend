const httpStatus = require('http-status');
const { pick } = require('lodash');
const catchAsync = require('../utils/catchAsync');
const ApiError = require('../utils/ApiError');
const ulearnStudentService = require('../services/ulearnStudent.service');
const config = require('../config/config');

/**
 * POST /v1/ulearn-students/auth/phone
 * Body: { idToken } — a Firebase ID token the frontend obtained by completing
 * the SMS/OTP exchange. The phone number is read from the VERIFIED token
 * payload, never from the request body. On success the student is upserted on
 * that phone identity, historical attempts are claimed, and the service's own
 * JWT is returned — the same token shape every other route already expects.
 */
const phoneAuth = catchAsync(async (req, res) => {
  const { idToken } = req.body;
  if (!idToken) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'idToken is required');
  }

  /**
   * Four distinct things happen here and any of them can fail. Outside
   * development the error handler replaces the message with "Internal Server
   * Error", so without naming the stage a 500 says nothing about whether the
   * token, the upsert, the claim or the signing broke.
   *
   * Each stage rethrows untouched — this only adds a log line.
   */
  const stage = async (name, fn) => {
    try {
      return await fn();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`ulearn phone auth: FAILED at "${name}"`, {
        name: err.name,
        message: err.message,
        statusCode: err.statusCode,
        // a duplicate key here almost always means the ulearnstudents
        // collection still carries the old non-partial unique indexes on
        // googleId/email, which the phone-auth migration drops
        mongoCode: err.code,
        keyPattern: err.keyPattern,
        keyValue: err.keyValue,
      });

      // An ApiError already carries a deliberate, safe message — pass it on.
      if (err instanceof ApiError) throw err;

      // Anything else becomes a 500 whose message the production error handler
      // would replace with a bare "Internal Server Error", leaving the browser
      // console with nothing to go on. Rethrow as an OPERATIONAL ApiError so
      // the stage survives that masking and reaches whoever is debugging.
      //
      // Deliberately safe to expose: the stage name, the error class and the
      // Mongo error number. NOT keyValue, which can contain a real email or
      // phone number, and not the stack.
      const kind = [err.name || 'Error', err.code].filter(Boolean).join(' ');
      const where = err.keyPattern ? ` on index ${Object.keys(err.keyPattern).join('+')}` : '';
      throw new ApiError(
        httpStatus.INTERNAL_SERVER_ERROR,
        `Sign-in failed while ${name} [${kind}${where}]`,
        true,
        err.stack
      );
    }
  };

  const payload = await stage('verify firebase token', () =>
    ulearnStudentService.verifyFirebaseIdToken(idToken)
  );
  const student = await stage('upsert student on the verified phone', () =>
    ulearnStudentService.upsertFromPhonePayload(payload)
  );

  // idempotent: only touches documents not yet linked to any student.
  // A claim failure must NOT cost the student their session — they are already
  // verified and upserted at this point, so log it and sign them in anyway.
  let claimed = { ielts: 0, major: 0, aptitude: 0 };
  try {
    claimed = await ulearnStudentService.claimHistoricalAttempts(student);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('ulearn phone auth: claiming failed, signing in anyway', {
      studentId: String(student._id),
      name: err.name,
      message: err.message,
      mongoCode: err.code,
    });
  }

  const token = await stage('sign the ulearn JWT', () =>
    ulearnStudentService.signStudentJwt(student)
  );
  res.status(httpStatus.OK).send({ token, student, claimed });
});

/**
 * POST /v1/ulearn-students/auth/google — LEGACY.
 *
 * Retained but disabled by default (ULEARN_GOOGLE_AUTH_ENABLED). Keeping the
 * handler means a rollback is an env flag rather than a redeploy of reverted
 * code; keeping it OFF means the surface is not reachable in normal operation.
 * The frontend no longer renders a Google button either way.
 */
const googleAuth = catchAsync(async (req, res) => {
  if (!config.ulearnStudents.googleAuthEnabled) {
    throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Google sign-in has been replaced by phone sign-in');
  }
  const { idToken } = req.body;
  if (!idToken) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'idToken is required');
  }

  const payload = await ulearnStudentService.verifyGoogleIdToken(idToken);
  const student = await ulearnStudentService.upsertFromGooglePayload(payload);

  const claimed = await ulearnStudentService.claimHistoricalAttempts(student);

  const token = ulearnStudentService.signStudentJwt(student);
  res.status(httpStatus.OK).send({ token, student, claimed });
});

/* ───────────────── back office (uapply-crm) ─────────────────
 * These are mounted behind the BACK-OFFICE auth (passport JWT + role rights),
 * not `ulearnStudentAuth`. A ülearn student token carries `type:
 * 'ulearn-student'` and is signed with a different secret, so it cannot
 * authenticate here — which is the point: one student must never be able to
 * read another's attempts. */

/**
 * GET /v1/ulearn-students/back-office/students
 * Paginated, searchable, filterable list of ülearn students, most recent
 * attempt first.
 */
const listStudentsForBackOffice = catchAsync(async (req, res) => {
  const query = pick(req.query, ['search', 'testType', 'hasAttempts', 'sortBy', 'limit', 'page']);
  const result = await ulearnStudentService.queryStudentsForBackOffice(query);
  res.send(result);
});

/**
 * GET /v1/ulearn-students/back-office/students/:studentId/tests
 * One student's attempts, grouped into the three test-type tabs.
 */
const getStudentTestsForBackOffice = catchAsync(async (req, res) => {
  const data = await ulearnStudentService.getStudentAttempts(req.params.studentId);
  res.send(data);
});

/**
 * PATCH /v1/ulearn-students/back-office/students/:studentId
 * The CRM-owned fields only. `status` is the pipeline state a counsellor sets;
 * identity, profile and test data are not writable from here.
 */
const updateStudentFromBackOffice = catchAsync(async (req, res) => {
  const updateBody = pick(req.body, ['status']);
  const student = await ulearnStudentService.updateStudentFromBackOffice(req.params.studentId, updateBody);
  res.send(student);
});

/** GET /v1/ulearn-students/me */
const getMe = catchAsync(async (req, res) => {
  res.send(req.ulearnStudent);
});

/**
 * PATCH /v1/ulearn-students/me — profile fields only.
 *
 * `phone` is deliberately NOT in this list. It is the account's identity now,
 * written once from a verified Firebase token; accepting it here would let a
 * client overwrite its own identity with an arbitrary number and then claim
 * whatever that number's attempts are. The test flows still send a phone in
 * their fill-once profile sync — it is silently dropped by this pick, which is
 * the intended behaviour.
 */
const updateMe = catchAsync(async (req, res) => {
  const updateBody = pick(req.body, [
    'name',
    'dob',
    'nationality',
    'destination',
    'studyLevel',
    'targetScore',
    'degree',
    'previousSchool',
    'cgpa',
    'englishProficiency',
    'consent',
  ]);
  const student = await ulearnStudentService.updateProfile(req.ulearnStudent, updateBody);
  res.send(student);
});

/** GET /v1/ulearn-students/me/tests — unified reverse-chronological history */
const getMyTests = catchAsync(async (req, res) => {
  const tests = await ulearnStudentService.getUnifiedTests(req.ulearnStudent._id);
  res.send({ total: tests.length, results: tests });
});

/** GET /v1/ulearn-students/me/progress — per-type series, deltas, personal bests */
const getMyProgress = catchAsync(async (req, res) => {
  const progress = await ulearnStudentService.getProgress(req.ulearnStudent._id);
  res.send(progress);
});

module.exports = {
  listStudentsForBackOffice,
  updateStudentFromBackOffice,
  getStudentTestsForBackOffice,
  phoneAuth,
  googleAuth,
  getMe,
  updateMe,
  getMyTests,
  getMyProgress,
};
