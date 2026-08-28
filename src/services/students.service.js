const httpStatus = require('http-status');
const { Students } = require('../models');
const ApiError = require('../utils/ApiError');

/**
 * Create a student
 * @param {Object} studentBody
 * @returns {Promise<Students>}
 */
const createStudent = async (studentBody) => {
  if (await Students.isEmailTaken(studentBody.email)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Email already taken');
  }
  return Students.create(studentBody);
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
    console.error('Error saving student:', error);
    // Handle the error appropriately
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
const searchStudent = async (text, options) => {
  // eslint-disable-next-line security/detect-non-literal-regexp
  const regex = new RegExp(text, 'i');
  let students;

  if (options.stage) {
    students = await Students.paginate(
      {
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
                    regex: text,
                    options: 'i',
                  },
                },
              },
            ],
          },
        ],
      },
      options
    );
  } else {
    students = await Students.paginate(
      {
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
                regex: text,
                options: 'i',
              },
            },
          },
        ],
      },
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
      $match: { ...query, stage: 'Applied' },
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
        stage: { $in: ['Applied', 'Enrolled'] }, // Applied or Enrolled students
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
        $match: { ...query, stage: 'Enrolled' },
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
    stage: { $in: ['Applied', 'Enrolled'] },
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
    stage: { $in: ['Applied', 'Enrolled'] },
  };
  return Students.aggregate([
    { $match: match },
    { $group: { _id: '$preference.studyDestinations', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 8 },
    { $project: { _id: 0, label: '$_id', count: 1 } },
  ]);
};

// Per-counselor funnel leaderboard for the counselor "My Desk" Season board.
// Groups students by their assigned counselor (assignedTo slot with role
// counselor) and counts Applied / Offers / Enrolled. "Offers" = students with
// at least one application carrying a Conditional/Unconditional offer phase.
const getCounselorLeaderboard = async ({ startDate, endDate } = {}) => {
  const OFFER_STATUSES = ['Conditional offer', 'Unconditional offer'];
  const match = {};
  if (startDate && endDate) {
    match.createdAt = { $gte: new Date(startDate), $lte: new Date(endDate) };
  }
  const rows = await Students.aggregate([
    { $match: match },
    { $unwind: '$assignedTo' },
    {
      $match: {
        'assignedTo.user': { $ne: null },
        'assignedTo.role': { $in: ['counselor', 'counsellor'] },
      },
    },
    {
      $lookup: {
        from: 'applications',
        localField: 'applications',
        foreignField: '_id',
        as: '_apps',
      },
    },
    {
      $addFields: {
        _hasOffer: {
          $gt: [
            {
              $size: {
                $filter: {
                  input: '$_apps',
                  as: 'a',
                  cond: {
                    $gt: [
                      {
                        $size: {
                          $filter: {
                            input: {
                              $ifNull: ['$$a.portalApplicationStatus.applicationPhases', []],
                            },
                            as: 'p',
                            // phaseState matters. Testing the status alone
                            // matched EVERY application: all eight phases are
                            // written into the array at creation, so
                            // "has a phase called Conditional offer" is true
                            // from the moment an application exists — which
                            // made this leaderboard column count students with
                            // any application at all, not students with offers.
                            cond: {
                              $and: [
                                { $in: ['$$p.status', OFFER_STATUSES] },
                                { $eq: ['$$p.phaseState', 'AwaitingResponseStudent'] },
                              ],
                            },
                          },
                        },
                      },
                      0,
                    ],
                  },
                },
              },
            },
            0,
          ],
        },
      },
    },
    {
      $group: {
        _id: '$assignedTo.user',
        applied: {
          $sum: {
            $cond: [{ $in: ['$stage', ['Applied', 'Enrolled', 'PendingReview']] }, 1, 0],
          },
        },
        enrolled: { $sum: { $cond: [{ $eq: ['$stage', 'Enrolled'] }, 1, 0] } },
        offers: { $sum: { $cond: ['$_hasOffer', 1, 0] } },
        students: { $sum: 1 },
      },
    },
    {
      $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: '_u' },
    },
    { $unwind: { path: '$_u', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 0,
        userId: '$_id',
        name: { $ifNull: ['$_u.name', 'Unknown'] },
        applied: 1,
        offers: 1,
        enrolled: 1,
        students: 1,
      },
    },
    { $sort: { applied: -1, offers: -1 } },
  ]);
  return rows;
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
    stage: { $in: ['Applied', 'Enrolled'] },
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
    stage: { $in: ['Applied', 'Enrolled'] },
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
  const res = await Students.updateOne({ _id: studentId, stage: 'NotApplied' }, { $set: { stage: 'Applied' } });
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
    { $set: { stage: 'Enrolled' } }
  );
  return !!(res && res.modifiedCount);
};

module.exports = {
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
