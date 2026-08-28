const httpStatus = require('http-status');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const { UlearnStudent, IeltsTest, Major } = require('../models');
const AptitudeTest = require('../models/aptitudeTest.model');
const ApiError = require('../utils/ApiError');
const config = require('../config/config');
const firebaseAuthService = require('./firebaseAuth.service');
const { parsePhone, matchPhone } = require('../utils/ulearnPhone');

const googleClient = new OAuth2Client(config.google.clientId);

/* ─────────────────────────── auth ─────────────────────────── */

/**
 * Verify a Google ID token SERVER-SIDE (signature, audience, issuer, expiry).
 * The verified payload is the only trusted source of identity — client-sent
 * emails are never used for anything.
 * @param {string} idToken
 * @returns {Promise<Object>} verified token payload
 */
const verifyGoogleIdToken = async (idToken) => {
  if (!config.google.clientId) {
    throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Google sign-in is not configured');
  }
  let ticket;
  try {
    ticket = await googleClient.verifyIdToken({
      idToken,
      audience: config.google.clientId,
    });
  } catch (err) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Invalid Google token');
  }
  const payload = ticket.getPayload();
  if (!payload || !payload.sub || !payload.email || payload.email_verified !== true) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Google account email is not verified');
  }
  return payload;
};

/**
 * Create or update the student from a VERIFIED Google payload.
 * Matches by googleId first (stable), then by email (account seen before
 * Google id changes are not expected, but email uniqueness is enforced).
 * @param {Object} payload - verified Google ID token payload
 * @returns {Promise<UlearnStudent>}
 */
const upsertFromGooglePayload = async (payload) => {
  const email = payload.email.toLowerCase();
  // match on a Google-owned identity only. `email` alone is no longer a safe
  // key: a phone account could in principle carry an unverified email, and
  // matching that would let a Google sign-in absorb it.
  let student = await UlearnStudent.findOne({
    $or: [{ googleId: payload.sub }, { email, emailVerified: true }],
  });
  if (!student) {
    student = await UlearnStudent.create({
      googleId: payload.sub,
      email,
      emailVerified: true,
      authProvider: 'google',
      name: payload.name || '',
      avatar: payload.picture || '',
      lastLoginAt: new Date(),
    });
  } else {
    student.googleId = payload.sub;
    student.email = email;
    student.emailVerified = true;
    student.authProvider = student.authProvider || 'google';
    student.name = student.name || payload.name || '';
    student.avatar = payload.picture || student.avatar;
    student.lastLoginAt = new Date();
    await student.save();
  }
  return student;
};

/* ───────────────────── phone auth (Firebase) ───────────────────── */

/**
 * Verify a Firebase ID token and return the phone identity it proves.
 * Thin pass-through so callers depend on one service, not two.
 * @param {string} idToken
 */
const verifyFirebaseIdToken = (idToken) => firebaseAuthService.verifyFirebaseIdToken(idToken);

/**
 * Create or update the student from a VERIFIED Firebase phone payload.
 *
 * Match order, and why:
 *  1. firebaseUid — Firebase's stable id. Survives the student porting their
 *     number, so it must win over the number itself.
 *  2. phone + phoneVerified — the same number verified on an earlier device or
 *     before a uid was recorded.
 *
 * There is deliberately NO third step that adopts an existing account whose
 * *unverified* `phone` happens to match. Those numbers were typed by hand into
 * a test form; a single typo would otherwise hand the typist's account — name,
 * email, and every claimed result — to whoever actually owns that number.
 * Google-authenticated accounts are therefore never absorbed by a phone
 * sign-in. The student loses nothing real: their historical attempts are
 * phone-stamped, so the new phone account claims them below, and their profile
 * fields re-sync from the next test they take.
 *
 * @param {{uid: string, phoneNumber: string, name: string, picture: string}} payload
 * @returns {Promise<UlearnStudent>}
 */
const upsertFromPhonePayload = async (payload) => {
  const parsed = parsePhone(payload.phoneNumber);
  if (parsed.form !== 'international' || !parsed.e164) {
    // Firebase always emits E.164; reaching here means something upstream is
    // wrong and we must not create a half-identified account.
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Verified phone number is not usable');
  }

  const identity = {
    firebaseUid: payload.uid,
    phone: parsed.e164,
    phoneVerified: true,
    phoneDialCode: parsed.dialCode,
    phoneNational: parsed.national,
    authProvider: 'phone',
    lastLoginAt: new Date(),
  };

  let student =
    (await UlearnStudent.findOne({ firebaseUid: payload.uid })) ||
    (await UlearnStudent.findOne({ phone: parsed.e164, phoneVerified: true }));

  if (!student) {
    student = await UlearnStudent.create({
      ...identity,
      // Firebase phone tokens carry a display name only if one was set
      // elsewhere; the student's real name arrives from their first test.
      name: payload.name || '',
      avatar: payload.picture || '',
    });
    return student;
  }

  Object.assign(student, identity);
  if (!student.name && payload.name) student.name = payload.name;
  await student.save();
  return student;
};

/**
 * Issue this service's own JWT (independent of the passport/User auth).
 * @param {UlearnStudent} student
 * @returns {string}
 */
const signStudentJwt = (student) => {
  return jwt.sign({ sub: student.id, type: 'ulearn-student' }, config.ulearnStudents.jwtSecret, {
    expiresIn: `${config.ulearnStudents.jwtExpirationDays}d`,
  });
};

/**
 * Resolve a student from a service JWT (used by the auth middleware).
 * @param {string} token
 * @returns {Promise<UlearnStudent>}
 */
const getStudentFromJwt = async (token) => {
  let decoded;
  try {
    decoded = jwt.verify(token, config.ulearnStudents.jwtSecret);
  } catch (err) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Please authenticate');
  }
  if (decoded.type !== 'ulearn-student') {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Please authenticate');
  }
  const student = await UlearnStudent.findById(decoded.sub);
  if (!student) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Please authenticate');
  }
  return student;
};

/* ──────────────────── headlines (per test type) ──────────────────── */
// Null-safe: IELTS writing can legitimately be unscored (AI unavailable).

// `timeTaken` is stored differently per test: IELTS as {total(seconds),
// formatted}, aptitude as a bare number, major as a preformatted string.
// It is passed through as-is; the frontend normalises it for display.
const headlineFor = {
  ielts: (doc) => ({
    overall: doc.scores?.overall?.bandScore ?? null,
    level: doc.scores?.overall?.level ?? null,
    reading: doc.scores?.reading?.bandScore ?? null,
    writing: doc.scores?.writing?.bandScore ?? null,
    listening: doc.scores?.listening?.bandScore ?? null,
    timeTaken: doc.timeTaken?.total ?? doc.timeTaken?.formatted ?? null,
  }),
  aptitude: (doc) => ({
    score: doc.score ?? null,
    testType: doc.testType || null,
    language: doc.language || null,
    timeTaken: doc.timeTaken ?? null,
  }),
  major: (doc) => ({
    qualified: doc.qualified ?? null,
    // the major test recommends five majors — return them all
    majors: Array.isArray(doc.majors) ? doc.majors.slice(0, 5) : [],
    timeTaken: doc.timeTaken || null,
  }),
};

const toSummaryEntry = (testType, doc) => ({
  testType,
  refId: doc._id,
  takenAt: doc.createdAt || new Date(),
  headline: headlineFor[testType](doc),
});

/* ─────────────────────── linking + claiming ─────────────────────── */

const MODEL_FOR = { ielts: IeltsTest, aptitude: AptitudeTest, major: Major };

/**
 * Recompute the denormalised attempt rollup for one student.
 *
 * WHY RECOMPUTE RATHER THAN INCREMENT
 * -----------------------------------
 * A counter has to be incremented on every path that can create a linkage —
 * new attempts, claimed historical attempts, and any future backfill — and it
 * silently drifts the first time one of those paths is missed or runs twice.
 * Recomputing costs three indexed countDocuments plus one indexed
 * find().sort().limit(1) against `studentId`, all of which are cheap, and the
 * result is correct by construction no matter how it was reached.
 *
 * Fire-and-forget safe: a failure here must never break a test submission or a
 * sign-in, so it logs and returns rather than throwing.
 *
 * @param {ObjectId} studentId
 * @returns {Promise<void>}
 */
const refreshAttemptRollup = async (studentId) => {
  try {
    if (!studentId) return;

    const types = ['ielts', 'aptitude', 'major'];
    const counts = await Promise.all(types.map((type) => MODEL_FOR[type].countDocuments({ studentId })));

    // the newest attempt across all three, which is what the list sorts on
    const latestPerType = await Promise.all(
      types.map((type) =>
        MODEL_FOR[type]
          .findOne({ studentId })
          .sort({ createdAt: -1 })
          .select('createdAt scores score testType language qualified majors timeTaken')
      )
    );

    let newest = null;
    latestPerType.forEach((doc, index) => {
      if (!doc) return;
      const takenAt = doc.createdAt || null;
      if (!takenAt) return;
      if (!newest || new Date(takenAt) > new Date(newest.takenAt)) {
        newest = { testType: types[index], takenAt, headline: headlineFor[types[index]](doc) };
      }
    });

    const attemptCounts = {
      ielts: counts[0],
      aptitude: counts[1],
      major: counts[2],
      total: counts[0] + counts[1] + counts[2],
    };

    await UlearnStudent.updateOne(
      { _id: studentId },
      {
        $set: {
          attemptCounts,
          lastAttemptAt: newest ? newest.takenAt : null,
          lastAttempt: newest || null,
        },
      }
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('ulearn-students: refreshAttemptRollup failed:', err.message);
  }
};

/**
 * Attach a freshly created test document to a student (called by the three
 * test controllers when the submission was authenticated). Fire-and-forget
 * safe: never throws.
 * @param {ObjectId} studentId
 * @param {'ielts'|'aptitude'|'major'} testType
 * @param {Object} doc - the created test document
 */
const recordAttempt = async (studentId, testType, doc) => {
  try {
    await UlearnStudent.updateOne(
      { _id: studentId, 'attemptsSummary.refId': { $ne: doc._id } },
      { $push: { attemptsSummary: toSummaryEntry(testType, doc) } }
    );
    // keep the back-office rollup in step with the new attempt
    await refreshAttemptRollup(studentId);
  } catch (err) {
    // linkage must never break test submission
    // eslint-disable-next-line no-console
    console.error('ulearn-students: recordAttempt failed:', err.message);
  }
};

/**
 * Where each collection keeps the phone, and under what shape.
 * Major is the awkward one: the dial code lives in its own column.
 */
const PHONE_FIELDS = {
  ielts: { phone: 'phone', dialCode: null },
  aptitude: { phone: 'number', dialCode: null },
  major: { phone: 'phoneNo', dialCode: 'countryCode' },
};

const SELECT_FIELDS = '_id createdAt scores score testType language qualified majors timeTaken email phone number phoneNo countryCode';

/**
 * Can this student's national digits be confused with another account's?
 *
 * The weak claim tier matches a stored number that declared no country code
 * against the verified number's national digits. "55001122" could be Kuwaiti
 * (+965) or Saudi (+966); if BOTH people have accounts here, letting either
 * claim it is a coin flip with someone else's results.
 *
 * So: refuse the weak tier entirely whenever another account holds the same
 * national digits under a different dial code. The check is cheap — it is one
 * indexed lookup on phoneNational — and it fails closed.
 *
 * KNOWN LIMIT (recorded deliberately): this is evaluated at claim time. If the
 * Saudi student registers a month later, an attempt already claimed by the
 * Kuwaiti student stays claimed. That is why every weak-tier claim is written
 * to `claimAudit` with basis 'national', so a support ticket can be traced and
 * reversed rather than argued about.
 *
 * @param {UlearnStudent} student
 * @returns {Promise<boolean>} true when national-digit matching is safe
 */
const nationalMatchIsUnambiguous = async (student) => {
  if (!student.phoneNational || !student.phoneDialCode) return false;
  const rival = await UlearnStudent.findOne({
    _id: { $ne: student._id },
    phoneVerified: true,
    phoneNational: student.phoneNational,
    phoneDialCode: { $ne: student.phoneDialCode },
  }).select('_id');
  return !rival;
};

/**
 * Claim historical anonymous attempts for a student.
 *
 * THE CLAIM RULE
 * --------------
 * An attempt is claimable only when it is not already linked to any student
 * (`studentId: null`) AND one of these holds:
 *
 *   basis 'email'    — the stored email equals the student's email AND the
 *                      student's email is PROVIDER-VERIFIED. The emailVerified
 *                      gate is new and load-bearing: a phone-authenticated
 *                      student's email is just something they typed into a
 *                      test form, so without this gate anyone could type a
 *                      stranger's address and inherit their IELTS history.
 *
 *   basis 'exact'    — the stored phone carries a country code (a leading "+",
 *                      a "00" prefix, or Major's separate countryCode column)
 *                      and its E.164 form equals the Firebase-verified number.
 *                      Nothing further is needed: both sides name a country.
 *
 *   basis 'national' — the stored phone declared no country and its subscriber
 *                      digits equal the verified number's. Gated on
 *                      nationalMatchIsUnambiguous(); refused otherwise.
 *
 * Anything shorter than 7 digits is never matched at all (see utils/ulearnPhone).
 *
 * Phone matching is done in application code rather than as a Mongo query
 * because the stored values are not normalised in the database — the same
 * number appears as "+965 5500 1122", "0096555001122" and "55001122" across
 * years of form submissions, and no index can compare those. Candidates are
 * narrowed by an indexed studentId:null scan per collection first.
 *
 * @param {UlearnStudent} student
 * @returns {Promise<{ielts: number, major: number, aptitude: number}>}
 */
const claimHistoricalAttempts = async (student) => {
  const claimed = { ielts: 0, major: 0, aptitude: 0 };
  const audit = [];

  // ── the verified phone, parsed once ──
  const verified = student.phoneVerified && student.phone ? parsePhone(student.phone) : null;
  const allowNational = verified ? await nationalMatchIsUnambiguous(student) : false;

  // ── the email tier, now gated on provider verification ──
  const emailClaimable = Boolean(student.emailVerified && student.email);
  const emailMatch = emailClaimable
    ? { $regex: `^${student.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' }
    : null;

  const claimCollection = async (Model, testType) => {
    const fields = PHONE_FIELDS[testType];
    const or = [];
    if (emailMatch && testType !== 'aptitude') or.push({ email: emailMatch });
    // narrow by "has a phone value at all" so we never scan the whole collection
    if (verified) or.push({ [fields.phone]: { $nin: [null, ''] } });
    if (!or.length) return 0;

    const candidates = await Model.find({ studentId: null, $or: or }).select(SELECT_FIELDS);
    if (!candidates.length) return 0;

    const matched = [];
    candidates.forEach((doc) => {
      // strongest basis wins, and email is only consulted when verified
      if (emailMatch && doc.email && doc.email.toLowerCase() === student.email) {
        matched.push({ doc, basis: 'email' });
        return;
      }
      if (!verified) return;
      const storedDial = fields.dialCode ? doc[fields.dialCode] : undefined;
      const result = matchPhone(parsePhone(doc[fields.phone], storedDial), verified);
      if (result === 'exact') {
        matched.push({ doc, basis: 'exact' });
      } else if (result === 'national' && allowNational) {
        matched.push({ doc, basis: 'national' });
      }
    });

    if (!matched.length) return 0;

    const ids = matched.map((m) => m.doc._id);
    await Model.updateMany({ _id: { $in: ids } }, { $set: { studentId: student._id } });

    const existing = new Set((student.attemptsSummary || []).map((a) => String(a.refId)));
    const entries = matched
      .filter((m) => !existing.has(String(m.doc._id)))
      .map((m) => toSummaryEntry(testType, m.doc));
    if (entries.length) {
      await UlearnStudent.updateOne({ _id: student._id }, { $push: { attemptsSummary: { $each: entries } } });
    }
    matched.forEach((m) => audit.push({ testType, refId: m.doc._id, basis: m.basis, at: new Date() }));
    return matched.length;
  };

  claimed.ielts = await claimCollection(IeltsTest, 'ielts');
  claimed.major = await claimCollection(Major, 'major');
  // NEW: aptitude attempts store a phone but never an email, so they were
  // unclaimable under the old email-only rule. A verified phone unlocks them.
  claimed.aptitude = await claimCollection(AptitudeTest, 'aptitude');

  if (audit.length) {
    await UlearnStudent.updateOne(
      { _id: student._id },
      { $set: { claimedAt: new Date() }, $push: { claimAudit: { $each: audit } } }
    );
    // claimed attempts change both the counts and the most-recent date
    await refreshAttemptRollup(student._id);
  }
  return claimed;
};

/* ─────────────────── history + progress (derived) ─────────────────── */

/**
 * Unified reverse-chronological test history, derived from the three test
 * collections by indexed studentId (source of truth — not the summary cache).
 * @param {ObjectId} studentId
 * @returns {Promise<Array>}
 */
const getUnifiedTests = async (studentId) => {
  const [ielts, aptitude, majors] = await Promise.all([
    IeltsTest.find({ studentId }).select('createdAt scores timeTaken aiEvaluated').sort({ createdAt: -1 }),
    AptitudeTest.find({ studentId }).select('createdAt score testType language timeTaken').sort({ createdAt: -1 }),
    Major.find({ studentId }).select('createdAt qualified majors timeTaken').sort({ createdAt: -1 }),
  ]);

  const rows = [
    ...ielts.map((d) => ({ testType: 'ielts', refId: d.id, takenAt: d.createdAt, headline: headlineFor.ielts(d) })),
    ...aptitude.map((d) => ({ testType: 'aptitude', refId: d.id, takenAt: d.createdAt, headline: headlineFor.aptitude(d) })),
    ...majors.map((d) => ({ testType: 'major', refId: d.id, takenAt: d.createdAt, headline: headlineFor.major(d) })),
  ];
  return rows.sort((a, b) => new Date(b.takenAt) - new Date(a.takenAt));
};

/** delta helper tolerant of unscored (null) values */
const delta = (curr, prev) => (typeof curr === 'number' && typeof prev === 'number' ? Math.round((curr - prev) * 100) / 100 : null);

/**
 * Progress per test type: chronological attempt series, deltas between
 * consecutive attempts, and personal bests — always derived from the test
 * documents so it can never drift from the source of truth.
 * @param {ObjectId} studentId
 * @returns {Promise<Object>}
 */
const getProgress = async (studentId) => {
  const [ielts, aptitude] = await Promise.all([
    IeltsTest.find({ studentId }).select('createdAt scores').sort({ createdAt: 1 }),
    AptitudeTest.find({ studentId }).select('createdAt score testType language').sort({ createdAt: 1 }),
  ]);

  const ieltsSeries = ielts.map((d, i) => {
    const h = headlineFor.ielts(d);
    const prev = i > 0 ? headlineFor.ielts(ielts[i - 1]) : null;
    return {
      attempt: i + 1,
      takenAt: d.createdAt,
      ...h,
      overallDelta: prev ? delta(h.overall, prev.overall) : null,
    };
  });

  const aptitudeSeries = aptitude.map((d, i) => ({
    attempt: i + 1,
    takenAt: d.createdAt,
    score: d.score ?? null,
    testType: d.testType || null,
    language: d.language || null,
    scoreDelta: i > 0 ? delta(d.score, aptitude[i - 1].score) : null,
  }));

  const best = (arr, key) => arr.reduce((max, r) => (typeof r[key] === 'number' && (max === null || r[key] > max) ? r[key] : max), null);

  return {
    ielts: {
      attempts: ieltsSeries.length,
      series: ieltsSeries,
      personalBest: {
        overall: best(ieltsSeries, 'overall'),
        reading: best(ieltsSeries, 'reading'),
        writing: best(ieltsSeries, 'writing'),
        listening: best(ieltsSeries, 'listening'),
      },
      latestVsBest:
        ieltsSeries.length > 0 ? delta(ieltsSeries[ieltsSeries.length - 1].overall, best(ieltsSeries, 'overall')) : null,
    },
    aptitude: {
      attempts: aptitudeSeries.length,
      series: aptitudeSeries,
      personalBest: { score: best(aptitudeSeries, 'score') },
    },
    // major test is a one-off recommendation, not a scored retake — expose
    // the latest result rather than a series
    major: await Major.findOne({ studentId }).select('createdAt qualified majors').sort({ createdAt: -1 }),
  };
};

/* ──────────────────── back office (uapply-crm) ──────────────────── */

/**
 * Fill the attempt rollup from `attemptsSummary` when it is missing.
 *
 * The rollup is written by refreshAttemptRollup, which runs on new attempts and
 * on claiming — and by the backfill migration for everyone who predates it.
 * Until that migration runs, EVERY existing student has a null `lastAttemptAt`
 * and a zero count, so the CRM would show "No tests yet" on every single row
 * even for students with a long history.
 *
 * `attemptsSummary` is already on the document and already holds
 * {testType, takenAt, headline} per attempt, so it costs nothing to derive a
 * display value from it. This only affects what is DISPLAYED — the sort still
 * uses the indexed `lastAttemptAt` and is still wrong until the migration runs,
 * because a per-row fallback cannot reorder a paginated query.
 *
 * @param {Object} doc - a plain (toJSON'd) student
 * @returns {Object} the same student with the rollup filled where derivable
 */
const withRollupFallback = (doc) => {
  if (!doc) return doc;
  const counts = doc.attemptCounts || {};
  const hasRollup = doc.lastAttemptAt || counts.total > 0;
  if (hasRollup) return doc;

  const summary = Array.isArray(doc.attemptsSummary) ? doc.attemptsSummary : [];
  if (!summary.length) return doc;

  const derived = { ielts: 0, aptitude: 0, major: 0, total: 0 };
  let newest = null;
  summary.forEach((entry) => {
    if (!entry || !entry.testType) return;
    if (derived[entry.testType] === undefined) return;
    derived[entry.testType] += 1;
    derived.total += 1;
    const takenAt = entry.takenAt || null;
    if (takenAt && (!newest || new Date(takenAt) > new Date(newest.takenAt))) {
      newest = { testType: entry.testType, takenAt, headline: entry.headline || null };
    }
  });

  return {
    ...doc,
    attemptCounts: derived,
    lastAttemptAt: newest ? newest.takenAt : doc.lastAttemptAt || null,
    lastAttempt: newest || doc.lastAttempt || null,
    // so the CRM (and a future support ticket) can tell a derived value from a
    // stored one without guessing
    rollupDerivedFromSummary: true,
  };
};

/**
 * Paginated list of ülearn students for the CRM.
 *
 * Ordered by `lastAttemptAt` descending — the denormalised rollup — so the
 * student who tested most recently is first and the query stays a single
 * indexed sort that the shared paginate plugin can page through. Students who
 * have never taken a test have a null `lastAttemptAt` and therefore sort last
 * in Mongo's descending order, which is what a counsellor wants.
 *
 * Deliberately does NOT fan out per row: everything a row shows comes from the
 * student document itself.
 *
 * @param {Object} query - raw req.query
 * @param {string} [query.search] - matches name or phone (any stored shape)
 * @param {string} [query.testType] - 'ielts' | 'aptitude' | 'major'
 * @param {boolean} [query.hasAttempts] - only students with at least one attempt
 * @returns {Promise<{results: Array, page: number, limit: number, totalPages: number, totalResults: number}>}
 */
const queryStudentsForBackOffice = async (query = {}) => {
  const filter = {};

  if (query.testType && ['ielts', 'aptitude', 'major'].includes(query.testType)) {
    filter[`attemptCounts.${query.testType}`] = { $gt: 0 };
  }
  if (String(query.hasAttempts) === 'true') {
    filter['attemptCounts.total'] = { $gt: 0 };
  }

  const search = (query.search || '').trim();
  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const digits = search.replace(/\D/g, '');
    const or = [{ name: { $regex: escaped, $options: 'i' } }];
    if (digits.length >= 3) {
      // a counsellor may paste "+965 5500 1122", "96555001122" or the national
      // part alone; match the stored E.164 and the split national digits both
      or.push({ phone: { $regex: digits, $options: 'i' } });
      or.push({ phoneNational: { $regex: digits, $options: 'i' } });
    }
    if (search.includes('@')) or.push({ email: { $regex: escaped, $options: 'i' } });
    filter.$or = or;
  }

  const options = {
    sortBy: query.sortBy || 'lastAttemptAt:desc',
    limit: query.limit,
    page: query.page,
  };

  const page = await UlearnStudent.paginate(filter, options);
  page.results = (page.results || []).map((doc) =>
    withRollupFallback(typeof doc.toJSON === 'function' ? doc.toJSON() : doc)
  );
  return page;
};

/**
 * Update the CRM-owned fields on a student. Deliberately a tiny allow-list:
 * the back office sets pipeline state, never identity or test data.
 * @param {ObjectId} studentId
 * @param {Object} updateBody
 * @returns {Promise<UlearnStudent>}
 */
const updateStudentFromBackOffice = async (studentId, updateBody) => {
  const student = await UlearnStudent.findById(studentId);
  if (!student) {
    throw new ApiError(httpStatus.NOT_FOUND, 'ulearn student not found');
  }
  Object.assign(student, updateBody);
  await student.save();
  return student;
};

/**
 * One student's attempts for the CRM detail view, grouped by test type.
 *
 * Derived from the three test collections rather than `attemptsSummary`, which
 * is only a read cache and can lag. Counts come back alongside so the UI can
 * decide which tabs to render without a second call.
 *
 * @param {ObjectId} studentId
 * @returns {Promise<{student: UlearnStudent, counts: Object, tabs: {ielts: Array, aptitude: Array, major: Array}}>}
 */
const getStudentAttempts = async (studentId) => {
  const student = await UlearnStudent.findById(studentId);
  if (!student) {
    throw new ApiError(httpStatus.NOT_FOUND, 'ulearn student not found');
  }

  const rows = await getUnifiedTests(student._id);
  const tabs = { ielts: [], aptitude: [], major: [] };
  rows.forEach((row) => {
    if (tabs[row.testType]) tabs[row.testType].push(row);
  });

  return {
    student: withRollupFallback(typeof student.toJSON === 'function' ? student.toJSON() : student),
    counts: {
      ielts: tabs.ielts.length,
      aptitude: tabs.aptitude.length,
      major: tabs.major.length,
      total: rows.length,
    },
    tabs,
  };
};

/* ─────────────────────────── profile ─────────────────────────── */

/**
 * Update the editable profile fields (identity fields are Google-owned).
 * @param {UlearnStudent} student
 * @param {Object} updateBody - pre-picked allowed fields
 * @returns {Promise<UlearnStudent>}
 */
const updateProfile = async (student, updateBody) => {
  Object.assign(student, updateBody);
  await student.save();
  return student;
};

module.exports = {
  refreshAttemptRollup,
  updateStudentFromBackOffice,
  withRollupFallback,
  queryStudentsForBackOffice,
  getStudentAttempts,
  verifyGoogleIdToken,
  upsertFromGooglePayload,
  verifyFirebaseIdToken,
  upsertFromPhonePayload,
  nationalMatchIsUnambiguous,
  signStudentJwt,
  getStudentFromJwt,
  recordAttempt,
  claimHistoricalAttempts,
  getUnifiedTests,
  getProgress,
  updateProfile,
};
