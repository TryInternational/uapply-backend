const httpStatus = require('http-status');
const { Students } = require('../models');
const logger = require('../config/logger');

/**
 * "A student who applied", for the dashboard's student-level stats: in the
 * Applied or Enrolled stage now or in an earlier journey, OR lost after at
 * least one application was made (a Lost student with applications applied;
 * one who went 🔥 Hot → Lost with none did not). Same rule as the
 * "Students who applied" chart, which works from the application rows.
 */
const APPLIED_STUDENT = {
  $or: [
    { stage: { $in: ['Applied', 'Enrolled'] } },
    { 'journeys.outcome': { $in: ['Applied', 'Enrolled'] } },
    { stage: 'Lost', 'applications.0': { $exists: true } },
    { journeys: { $elemMatch: { outcome: 'Lost', 'applications.0': { $exists: true } } } },
  ],
};
const ApiError = require('../utils/ApiError');

/**
 * Create a student
 * @param {Object} studentBody
 * @returns {Promise<Students>}
 */
const createStudent = async (studentBody) => {
  const body = { ...studentBody };
  // No email is not "the same email as every other student without one".
  const email = typeof body.email === 'string' ? body.email.trim() : body.email;
  if (!email) delete body.email;
  else body.email = email;
  if (email && (await Students.isEmailTaken(String(email).toLowerCase()))) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'A student with this email address already exists');
  }
  return Students.create(body);
};

/**
 * Query for users
 * @param {Object} filter - Mongo filter
 * @param {Object} options - Query options
 * @param {string} [options.sortBy] - Sort option in the format: sortField:(desc|asc)
 * @param {number} [options.limit] - Maximum number of results per page (default = 10)
 * @param {number} [options.page] - Current page (default = 1)
 * @returns {Promise<QueryResult>}
 */
const queryStudents = async (filter, options) => {
  const students = await Students.paginate(filter, options);
  return students;
};

/**
 * Get student by id
 * @param {ObjectId} id
 * @returns {Promise<Students>}
 */
const getStudentById = async (id) => {
  return Students.findById(id);
};

/**
 * Get student by email
 * @param {string} email
 * @returns {Promise<Students>}
 */
const getStudentByEmail = async (email) => {
  return Students.findOne({ email });
};

/**
 * Update student by id
 * @param {ObjectId} studentId
 * @param {Object} updateBody
 * @returns {Promise<Students>}
 */
const updateStudentById = async (studentId, updateBody) => {
  try {
    const student = await getStudentById(studentId);
    if (!student) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Students not found');
    }
    // if (updateBody.email && (await Students.isEmailTaken(updateBody.email, studentId))) {
    //   throw new ApiError(httpStatus.BAD_REQUEST, 'Email already taken');
    // }
    Object.assign(student, updateBody);
    await student.save();

    return student;
  } catch (error) {
    logger.error(`Error saving student: ${(error && error.stack) || error}`);
    // Rethrow. Swallowing it here returned `undefined`, and every caller then
    // dereferenced it — so a failed save (a missing student, a field that did
    // not validate) surfaced as an unrelated TypeError and a 500 instead of
    // the 404 / 400 it actually was.
    throw error;
  }
};

/**
 * Delete student by id
 * @param {ObjectId} studentId
 * @returns {Promise<Students>}
 */
const deleteStudentById = async (studentId) => {
  const student = await getStudentById(studentId);
  if (!student) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Students not found');
  }
  await student.remove();
  return student;
};
// typed text is matched literally — "+965…" or "(" used to throw and fail the search
const literal = (v) => String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const searchStudent = async (text, options, scope = {}) => {
  // eslint-disable-next-line security/detect-non-literal-regexp
  const regex = new RegExp(literal(text), 'i');
  let students;
  // an optional "My students" condition (counselor / operations), ANDed in
  const scoped = (q) => (scope && Object.keys(scope).length ? { $and: [q, scope] } : q);

  if (options.stage) {
    students = await Students.paginate(
      scoped({
        $and: [
          {
            stage: options.stage,
            $or: [
              { firstName: regex },
              { lastName: regex },
              { middleName: regex },
              { phoneNo: regex },
              { email: regex },
              { refrenceNo: regex },
              {
                $expr: {
                  $regexMatch: {
                    input: { $concat: ['$firstName', ' ', '$middleName', ' ', '$lastName'] },
                    regex: literal(text),
                    options: 'i',
                  },
                },
              },
            ],
          },
        ],
      }),
      options
    );
  } else {
    students = await Students.paginate(
      scoped({
        $or: [
          { firstName: regex },
          { lastName: regex },
          { middleName: regex },
          { phoneNo: regex },
          { email: regex },
          { refrenceNo: regex },
          {
            $expr: {
              $regexMatch: {
                input: { $concat: ['$firstName', ' ', '$middleName', ' ', '$lastName'] },
                regex: literal(text),
                options: 'i',
              },
            },
          },
        ],
      }),
      options
    );
  }

  return students;
};

const getTopNationalities = async ({ startDate, endDate }) => {
  let query = {};

  if (startDate && endDate) {
    query = {
      ...query,
      createdAt: {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      },
    };
  }
  const topNationalities = await Students.aggregate([
    {
      // "the students who applied": Applied, and Enrolled (they applied too) — Enrolled was left out
      $match: { ...query, ...APPLIED_STUDENT },
    },
    {
      $group: {
        _id: '$nationality.english_name',
        countryCode: { $first: '$nationality.alpha2_code' },
        count: { $sum: 1 },
      },
    },
    {
      $sort: { count: -1 },
    },
  ]);

  return topNationalities;
};

const getTopAppliedIntake = async () => {
  // All applied students by intake — not date-scoped (mockup analytics card).
  const query = {};

  const topIntakes = await Students.aggregate([
    {
      $match: {
        ...query,
        ...APPLIED_STUDENT, // applied / enrolled, or lost after applying
      },
    },
    {
      $group: {
        _id: {
          year: '$preference.intakeYear',
          month: '$preference.intakeMonth',
        },
        count: { $sum: 1 },
      },
    },
    {
      $match: {
        '_id.year': { $ne: null },
        '_id.month': { $ne: null },
        count: { $gt: 0 },
      },
    },
    {
      $sort: { count: -1 },
    },
  ]);

  return topIntakes;
};

const getCountByAssignedRole = async ({ startDate, endDate }) => {
  try {
    let query = {};

    if (startDate && endDate) {
      query = {
        ...query,
        createdAt: {
          $gte: new Date(startDate),
          $lte: new Date(endDate),
        },
      };
    }
    const appliedPipeline = [
      {
        $match: { ...query, applications: { $exists: true, $not: { $size: 0 } } },
      },
      {
        $unwind: '$assignedTo',
      },
      {
        $group: {
          _id: {
            role: '$assignedTo.role',
            user: '$assignedTo.user',
          },
          count: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          role: '$_id.role',
          count: '$count',
          user: '$_id.user',
        },
      },
    ];

    const enrolledPipeline = [
      {
        // enrolled now, or in an earlier journey (a finished Foundation year)
        $match: { ...query, $or: [{ stage: 'Enrolled' }, { 'journeys.outcome': 'Enrolled' }] },
      },
      {
        $unwind: '$assignedTo',
      },
      {
        $group: {
          _id: {
            role: '$assignedTo.role',
            user: '$assignedTo.user',
          },
          count: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          role: '$_id.role',
          count: '$count',
          user: '$_id.user',
        },
      },
    ];

    const appliedResults = await Students.aggregate(appliedPipeline).exec();
    const enrolledResults = await Students.aggregate(enrolledPipeline).exec();

    const combinedResults = {};

    appliedResults.forEach((item) => {
      const key = `${item.role}-${item.user}`;
      combinedResults[key] = {
        appliedCount: item.count,
        enrolledCount: 0,
        tag: {},
        status: 'applied',
        role: item.role,
      };

      if (item.role === 'account manager') {
        combinedResults[key].tag.accountManager = item.user;
      } else if (item.role === 'sales') {
        combinedResults[key].tag.salesPerson = item.user;
      } else if (item.role === 'operations') {
        combinedResults[key].tag.operations = item.user;
      }
    });

    enrolledResults.forEach((item) => {
      const key = `${item.role}-${item.user}`;
      if (combinedResults[key]) {
        combinedResults[key].enrolledCount = item.count;
        combinedResults[key].status = 'enrolled';
      } else {
        combinedResults[key] = {
          appliedCount: 0,
          enrolledCount: item.count,
          tag: {},
          status: 'enrolled',
          role: item.role,
        };

        if (item.role === 'account manager') {
          combinedResults[key].tag.accountManager = item.user;
        } else if (item.role === 'sales') {
          combinedResults[key].tag.salesPerson = item.user;
        } else if (item.role === 'operations') {
          combinedResults[key].tag.operations = item.user;
        }
      }
    });

    const finalResults = Object.values(combinedResults);
    return finalResults;
  } catch (error) {
    throw new Error(`Error getting role counts: ${error.message}`);
  }
};

// Students grouped by study level, folded onto the four canonical levels
// (Foundation / Bachelor's / Master's / PhD) — always returns all four, 0 if
// none. preference.courseLevel is a String holding a CourseLevels _id, so
// convert + $lookup to resolve the human name.
const getStudentsByStudyLevel = async () => {
  // Students in the Applied or Enrolled stage — not date-scoped (mockup cards).
  const match = {
    'preference.courseLevel': { $nin: [null, ''] },
    ...APPLIED_STUDENT,
  };
  const rows = await Students.aggregate([
    { $match: match },
    { $group: { _id: '$preference.courseLevel', count: { $sum: 1 } } },
    { $addFields: { lvlOid: { $convert: { input: '$_id', to: 'objectId', onError: null, onNull: null } } } },
    { $lookup: { from: 'courselevels', localField: 'lvlOid', foreignField: '_id', as: 'lvl' } },
    { $project: { _id: 0, name: { $arrayElemAt: ['$lvl.en_name', 0] }, count: 1 } },
  ]);
  const buckets = { Foundation: 0, "Bachelor's": 0, "Master's": 0, PhD: 0 };
  rows.forEach((r) => {
    const s = String(r.name || '').toLowerCase();
    let k = null;
    if (s.includes('found')) k = 'Foundation';
    else if (s.includes('phd') || s.includes('doctor')) k = 'PhD';
    else if (s.includes('master') || s.includes('post')) k = "Master's";
    else if (s.includes('bachelor') || s.includes('under') || s.includes('degree') || s.includes('year')) k = "Bachelor's";
    if (k) buckets[k] += r.count;
  });
  return ['Foundation', "Bachelor's", "Master's", 'PhD']
    .map((label) => ({ label, count: buckets[label] }))
    .sort((a, b) => b.count - a.count);
};

// Students grouped by the role that handles them (assignedTo.role slot:
// sales / account manager / operations / counsellor) — "Where students come from".
// Not exported and nothing calls it (the dashboard no longer reads this aggregate).
// eslint-disable-next-line no-unused-vars
const getStudentsByRole = async ({ startDate, endDate }) => {
  const match = { 'assignedTo.0': { $exists: true } };
  if (startDate && endDate) {
    match.createdAt = { $gte: new Date(startDate), $lte: new Date(endDate) };
  }
  const rows = await Students.aggregate([
    { $match: match },
    { $unwind: '$assignedTo' },
    { $match: { 'assignedTo.role': { $nin: [null, ''] } } },
    { $group: { _id: '$assignedTo.role', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);
  const pretty = {
    sales: 'Sales',
    'account manager': 'Account Manager',
    operations: 'Operations',
    operation: 'Operation',
    counsellor: 'Counsellor',
    counselor: 'Counselor',
  };
  return rows.map((r) => ({ label: pretty[String(r._id).toLowerCase()] || r._id, count: r.count }));
};

// Students grouped by acquisition channel — "Where students come from".
// Always returns Sub-agent / School counselor / Online lead; Direct only when > 0.
const getStudentsByChannel = async ({ startDate, endDate }) => {
  // A referral the team turned down is not a student that channel delivered,
  // and a soft-deleted one is not a student at all — counting them inflated
  // every partner channel against the other cards on the page, which count
  // live students.
  const match = { stage: { $nin: ['Denied'] } };
  if (startDate && endDate) {
    match.createdAt = { $gte: new Date(startDate), $lte: new Date(endDate) };
  }
  const rows = await Students.aggregate([
    { $match: match },
    { $group: { _id: { $ifNull: ['$channel', 'direct'] }, count: { $sum: 1 } } },
  ]);
  const counts = {};
  rows.forEach((r) => {
    counts[String(r._id).toLowerCase()] = r.count;
  });
  // Every channel, always — including ones sitting at zero. Direct alone used
  // to be dropped when empty, so the channel that means "the team added this
  // student" vanished from the card instead of reading zero, which looked like
  // a data fault rather than a filter.
  //
  // Order: the three the system sets from who created the record, then the
  // ones staff pick when adding a student themselves.
  const LABELS = [
    ['subagent', 'Sub-agent'],
    ['counselor', 'School counselor'],
    ['lead', 'Online lead'],
    ['direct', 'Walk-in'],
    ['exhibition', 'Exhibition'],
    ['referral', 'Referral'],
    ['campaign', 'Campaign'],
    ['other', 'Other'],
  ];
  return LABELS.map(([key, label]) => ({ label, count: counts[key] || 0 }));
};

// All applied students grouped by destination (preference.studyDestinations = country).
const getStudentsByDestination = async () => {
  const match = {
    'preference.studyDestinations': { $nin: [null, ''] },
    ...APPLIED_STUDENT,
  };
  return Students.aggregate([
    { $match: match },
    { $group: { _id: '$preference.studyDestinations', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 8 },
    { $project: { _id: 0, label: '$_id', count: 1 } },
  ]);
};

// Sales leaderboard (Admin "Sales" panel, Counselor desk "Sales" card and
// applied pulse). For a date range it ranks each counsellor / salesperson by
// the students who APPLIED in that range, and, of those students, how many
// have reached an offer and how many enrolled:
//
//   applied   an applied event in the range — application.service
//             `appliedStudentIdsBetween`, the same rule as "Students who
//             applied", Team rankings and the Stats tab: the student's first
//             LIVE application for an intake (so a student back for a new
//             intake counts again), or the stage move when they were marked
//             applied without a university application
//   offers    of those, SINCE they applied: enrolled, or a LIVE application
//             that is not rejected and has reached Conditional offer or later
//   enrolled  of those, SINCE they applied: Enrolled, or an earlier journey
//             that ended Enrolled after that date. A student back for a new
//             intake used to bring an old enrolment along — Conversion read
//             8% beside 0 enrolled.
//
// Each row also carries the student ids behind it (`appliedStudents` with the
// student's course-level name, `offerIds`, `enrolledIds`) so the client can total
// DISTINCT students across people — summing per-person counts counted a
// student with two salespeople twice — and filter by level.
//
// Students with no counsellor / salesperson come back as one last row flagged
// `unassigned`. They were dropped, so the panel's total was short of the
// students who applied (82 shown, 84 applied) with nothing to say why.
const getCounselorLeaderboard = async ({ startDate, endDate } = {}) => {
  // required here: application.service and dashboardBreakdowns.service load models and each other
  // eslint-disable-next-line global-require
  const { Application, CourseLevels, User } = require('../models');
  // eslint-disable-next-line global-require
  const { LIVE_ONLY, appliedStudentsBetween } = require('./application.service');
  // eslint-disable-next-line global-require
  const { reachedIdx, enrolledSince, appsSince } = require('./dashboardBreakdowns.service');
  const OFFER_IDX = 2; // Conditional offer
  const idOf = (x) => String((x && (x._id || x.id)) || x || '');

  const appliedAt = await appliedStudentsBetween(startDate, endDate);
  const ids = Array.from(appliedAt.keys());
  if (!ids.length) return [];

  const [students, apps, levels] = await Promise.all([
    Students.find(
      { _id: { $in: ids } },
      {
        assignedTo: 1,
        stage: 1,
        enrolledAt: 1,
        'journeys.outcome': 1,
        'journeys.closedAt': 1,
        'preference.courseLevel': 1,
      },
      { autopopulate: false }
    ).lean(),
    Application.find(
      { ...LIVE_ONLY, studentId: { $in: ids } },
      { studentId: 1, rejected: 1, courseLevel: 1, createdAt: 1, 'portalApplicationStatus.applicationPhases': 1 },
      { autopopulate: false }
    ).lean(),
    CourseLevels.find({}, { en_name: 1 }).lean(),
  ]);
  const levelName = new Map(levels.map((l) => [idOf(l), l.en_name]));
  // the course-level NAME (the client buckets it, as its Level filter options are)
  const nameOfLevel = (raw) => (raw ? String(levelName.get(String(raw)) || raw) : null);
  const appsBy = new Map();
  apps.forEach((a) => appsBy.set(idOf(a.studentId), (appsBy.get(idOf(a.studentId)) || []).concat(a)));

  const COUNSELOR_ROLE = /^\s*(counsell?or|sales)\s*$/i;
  const rows = new Map();
  const unassigned = { appliedStudents: [], offerIds: [], enrolledIds: [] };
  students.forEach((st) => {
    const sid = idOf(st);
    const list = appsBy.get(sid) || [];
    const at = appliedAt.get(sid);
    const enrolled = enrolledSince(st, at);
    const offer = enrolled || appsSince(list, at).some((a) => !a.rejected && reachedIdx(a) >= OFFER_IDX);
    const level =
      nameOfLevel(st.preference && st.preference.courseLevel) ||
      list.map((a) => nameOfLevel(a.courseLevel)).find(Boolean) ||
      null;
    const seen = new Set();
    (st.assignedTo || []).forEach((slot) => {
      const role = Array.isArray(slot && slot.role) ? slot.role.join(' ') : slot && slot.role;
      const user = idOf(slot && slot.user);
      if (!user || user === 'null' || !COUNSELOR_ROLE.test(String(role || '')) || seen.has(user)) return;
      seen.add(user);
      const row = rows.get(user) || { userId: user, appliedStudents: [], offerIds: [], enrolledIds: [] };
      row.appliedStudents.push({ id: sid, level });
      if (offer) row.offerIds.push(sid);
      if (enrolled) row.enrolledIds.push(sid);
      rows.set(user, row);
    });
    if (!seen.size) {
      unassigned.appliedStudents.push({ id: sid, level });
      if (offer) unassigned.offerIds.push(sid);
      if (enrolled) unassigned.enrolledIds.push(sid);
    }
  });

  const users = await User.find({ _id: { $in: Array.from(rows.keys()) } }, { name: 1 }).lean();
  const nameOf = new Map(users.map((u) => [idOf(u), u.name]));
  const shape = (r, name) => ({
    userId: r.userId,
    name,
    applied: r.appliedStudents.length,
    offers: r.offerIds.length,
    enrolled: r.enrolledIds.length,
    students: r.appliedStudents.length,
    appliedStudents: r.appliedStudents,
    offerIds: r.offerIds,
    enrolledIds: r.enrolledIds,
  });
  const ranked = Array.from(rows.values())
    .map((r) => shape(r, nameOf.get(r.userId) || 'Unknown'))
    .sort((a, b) => b.applied - a.applied || b.offers - a.offers);
  return unassigned.appliedStudents.length
    ? ranked.concat({ ...shape({ ...unassigned, userId: 'unassigned' }, 'No sales person'), unassigned: true })
    : ranked;
};

// Maps a raw course-level name (courselevels.en_name) into one of the four
// dashboard buckets. Mirrors the inline logic in getStudentsByStudyLevel so
// the by-intake breakdown reconciles with the flat study-level-mix card.
// Aggregation expression: the distinct set of intakes a student is associated
// with. Prefers each application's own intake (falling back to the student's
// preference intake when an application has none); a student with no
// applications contributes a single intake from their preference. Requires a
// prior $lookup that populates `_apps` with the student's applications.
const buildStudentIntakes = {
  $setUnion: [
    {
      $cond: [
        { $gt: [{ $size: '$_apps' }, 0] },
        {
          $map: {
            input: '$_apps',
            as: 'a',
            in: {
              year: { $ifNull: ['$$a.intakeYear', '$preference.intakeYear'] },
              month: { $ifNull: ['$$a.intakeMonth', '$preference.intakeMonth'] },
            },
          },
        },
        [{ year: '$preference.intakeYear', month: '$preference.intakeMonth' }],
      ],
    },
  ],
};

const bucketCourseLevel = (name) => {
  const s = String(name || '').toLowerCase();
  if (!s) return null;
  if (s.includes('found')) return 'Foundation';
  if (s.includes('phd') || s.includes('doctor')) return 'PhD';
  if (s.includes('master') || s.includes('post')) return "Master's";
  if (s.includes('bachelor') || s.includes('under') || s.includes('degree') || s.includes('year')) {
    return "Bachelor's";
  }
  return null;
};

// Top destinations broken down by intake (year + month). The dashboard filters
// this client-side by intake, so the flat "all intakes" view still equals the
// existing topDestinations card. Not date-scoped, matching the flat card.
const getStudentsByDestinationAndIntake = async () => {
  const match = {
    'preference.studyDestinations': { $nin: [null, ''] },
    ...APPLIED_STUDENT,
  };
  const rows = await Students.aggregate([
    { $match: match },
    // preference.intake* is sparsely populated, so use the student's application
    // intakes (reliably set — same source as "Intake demand"). A student with
    // applications across several intakes contributes to each; students without
    // applications fall back to their preference intake.
    { $lookup: { from: 'applications', localField: 'applications', foreignField: '_id', as: '_apps' } },
    { $addFields: { _intakes: buildStudentIntakes } },
    { $unwind: '$_intakes' },
    {
      $group: {
        _id: {
          destination: '$preference.studyDestinations',
          year: '$_intakes.year',
          month: '$_intakes.month',
        },
        count: { $sum: 1 },
      },
    },
  ]);
  return rows.map((r) => ({
    label: r._id.destination,
    intake: r._id.month && r._id.year ? `${r._id.month} ${r._id.year}` : null,
    count: r.count,
  }));
};

// Study-level mix broken down by intake (year + month), bucketed into the four
// dashboard levels. Filtered client-side by intake.
const getStudyLevelMixByIntake = async () => {
  const match = {
    'preference.courseLevel': { $nin: [null, ''] },
    ...APPLIED_STUDENT,
  };
  const rows = await Students.aggregate([
    { $match: match },
    // Same per-application intake expansion as getStudentsByDestinationAndIntake.
    { $lookup: { from: 'applications', localField: 'applications', foreignField: '_id', as: '_apps' } },
    { $addFields: { _intakes: buildStudentIntakes } },
    { $unwind: '$_intakes' },
    {
      $group: {
        _id: {
          level: '$preference.courseLevel',
          year: '$_intakes.year',
          month: '$_intakes.month',
        },
        count: { $sum: 1 },
      },
    },
    {
      $addFields: {
        lvlOid: {
          $convert: { input: '$_id.level', to: 'objectId', onError: null, onNull: null },
        },
      },
    },
    { $lookup: { from: 'courselevels', localField: 'lvlOid', foreignField: '_id', as: 'lvl' } },
    {
      $project: {
        _id: 0,
        name: { $arrayElemAt: ['$lvl.en_name', 0] },
        year: '$_id.year',
        month: '$_id.month',
        count: 1,
      },
    },
  ]);
  const out = [];
  rows.forEach((r) => {
    const bucket = bucketCourseLevel(r.name);
    if (!bucket) return;
    out.push({
      label: bucket,
      intake: r.month && r.year ? `${r.month} ${r.year}` : null,
      count: r.count,
    });
  });
  return out;
};

// Every distinct intake across all students (from their applications, falling
// back to preference intake) — the full option list for the dashboard intake
// filter dropdowns, independent of what each card's counted rows contain.
const getStudentIntakeOptions = async () => {
  const rows = await Students.aggregate([
    { $lookup: { from: 'applications', localField: 'applications', foreignField: '_id', as: '_apps' } },
    { $addFields: { _intakes: buildStudentIntakes } },
    { $unwind: '$_intakes' },
    { $group: { _id: { year: '$_intakes.year', month: '$_intakes.month' } } },
  ]);
  const set = new Set();
  rows.forEach((r) => {
    if (r._id.month && r._id.year) set.add(`${r._id.month} ${r._id.year}`);
  });
  return [...set];
};

// Count of students created within the selected date range — drives the
// date-filterable "New students" KPI on the dashboard.
const getNewStudentsCount = async ({ startDate, endDate }) => {
  const match = {};
  if (startDate && endDate) {
    match.createdAt = { $gte: new Date(startDate), $lte: new Date(endDate) };
  }
  return Students.countDocuments(match);
};

const getDashboardData = async ({ startDate, endDate, filterOptions }) => {
  try {
    const [
      topNationalities,
      studentCountByRole,
      students,
      topIntake,
      studyLevelMix,
      topDestinations,
      studentsByChannel,
      topDestinationsByIntake,
      studyLevelMixByIntake,
      newStudentsCount,
      intakeOptions,
    ] = await Promise.all([
      getTopNationalities({ startDate, endDate }),
      getCountByAssignedRole({ startDate, endDate }),
      queryStudents(filterOptions.filter, filterOptions.options),
      getTopAppliedIntake({ startDate, endDate }),
      getStudentsByStudyLevel({ startDate, endDate }),
      getStudentsByDestination({ startDate, endDate }),
      getStudentsByChannel({ startDate, endDate }),
      getStudentsByDestinationAndIntake(),
      getStudyLevelMixByIntake(),
      getNewStudentsCount({ startDate, endDate }),
      getStudentIntakeOptions(),
    ]);

    return {
      topNationalities,
      studentCountByRole,
      students,
      topIntake,
      studyLevelMix,
      topDestinations,
      studentsByChannel,
      // Date-scoped count of students created in [startDate, endDate].
      newStudentsCount,
      // Per-intake breakdowns — the dashboard filters these client-side so the
      // intake multi-select on the Top destinations / Study level mix cards
      // recomputes without a round-trip.
      topDestinationsByIntake,
      studyLevelMixByIntake,
      // Full list of intake options for the dashboard filter dropdowns.
      intakeOptions,
    };
  } catch (error) {
    throw new Error(`Error fetching dashboard data: ${error.message}`);
  }
};

/**
 * Move a student to 'Applied' — but ONLY from 'NotApplied'.
 *
 * Called when a reviewer approves a school counsellor's application, so this is
 * a cross-document side effect of a review action, not a user edit. The stage
 * filter is in the QUERY, not read-then-write, for two reasons:
 *   - two reviewers approving different applications for the same student at
 *     the same moment cannot both fire a write that matters — the second one
 *     matches zero documents;
 *   - it can never regress anyone. Applied/Enrolled are already at-or-past,
 *     and Lost / Denied / PendingReview are review or terminal states that a
 *     background write must not silently resurrect — those need a human
 *     decision on the STUDENT, not a side effect of an application.
 * Returns true when the stage actually moved.
 */
const advanceStageToApplied = async (studentId) => {
  // updateOne skips the save hook that stamps appliedAt, so stamp it here
  const res = await Students.updateOne(
    { _id: studentId, stage: 'NotApplied' },
    { $set: { stage: 'Applied', appliedAt: new Date() } }
  );
  return !!(res && res.modifiedCount);
};

/**
 * An application reaching its final phase (Done/Enrolled) enrols the STUDENT.
 * Same condition-in-the-query pattern as advanceStageToApplied: the stage
 * check rides in the update filter, so two concurrent phase moves cannot
 * double-fire the activity/notification that hangs off the true return.
 * Applied is the normal path; NotApplied is included because older staff
 * flows never set Applied — an enrolled student should read Enrolled either
 * way. Denied/PendingReview/Lost stay untouched.
 */
const advanceStageToEnrolled = async (studentId) => {
  const res = await Students.updateOne(
    { _id: studentId, stage: { $in: ['Applied', 'NotApplied'] } },
    // updateOne skips the model's save hook, so the enrolment date is stamped here
    { $set: { stage: 'Enrolled', enrolledAt: new Date() }, $unset: { lostAt: 1 } }
  );
  return !!(res && res.modifiedCount);
};

module.exports = {
  APPLIED_STUDENT,
  createStudent,
  advanceStageToApplied,
  advanceStageToEnrolled,
  queryStudents,
  getStudentById,
  getStudentByEmail,
  updateStudentById,
  getTopNationalities,
  deleteStudentById,
  searchStudent,
  getCountByAssignedRole,
  getDashboardData,
  getTopAppliedIntake,
  getCounselorLeaderboard,
};
