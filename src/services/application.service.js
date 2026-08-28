/* eslint-disable object-shorthand */
/* eslint-disable no-plusplus */
const { Application } = require('../models');
const logger = require('../config/logger');

/**
 * Applications that count as REAL for staff lists, KPIs and dashboards.
 *
 * A sub-agent submission is created with the full eight-phase pipeline already
 * populated, so without this filter it would appear in every staff list and
 * chart the moment it was submitted -- before any counsellor had seen it -- and
 * a REJECTED one would keep being counted forever. That is influence over staff
 * views obtained without touching a single review endpoint.
 *
 * `$nin` also matches documents where the field is ABSENT, which is every
 * application created before this feature shipped. Existing data is therefore
 * unaffected: nothing disappears from a dashboard on deploy.
 */
const LIVE_ONLY = {
  reviewStatus: {
    $nin: ['DRAFT', 'SUBMITTED_BY_SUBAGENT', 'SUBMITTED_BY_COUNSELOR', 'REJECTED', 'RETURNED_FOR_EDIT'],
  },
};

// Function to find an application by ID
async function findApplicationById(id) {
  try {
    const application = await Application.findById(id);
    return application;
  } catch (err) {
    throw new Error(`Failed to find application with ID ${id}: ${err.message}`);
  }
}

async function getApplications(data) {
  try {
    // Initialize the query object. LIVE_ONLY keeps sub-agent submissions that
    // have not been approved yet out of the staff list.
    const query = { ...LIVE_ONLY };

    // Ensure status values are trimmed and properly formatted
    if (data.status && data.status.length > 0) {
      const statuses = data.status.map((status) => status.trim());
      const statusPatterns = statuses.map((status) => new RegExp(`^${status}$`, 'i'));

      // Add the status filter to the query if statuses are provided
      // Matched on the phase the application is AT, not the one behind it.
      // `isPrevious` was the old "furthest completed" convention; the board now
      // places a badge by its awaiting phase, so filtering on isPrevious
      // returned applications that then rendered one column away from the
      // stage the user had just filtered for.
      query['portalApplicationStatus.applicationPhases'] = {
        $elemMatch: {
          status: { $in: statusPatterns },
          phaseState: 'AwaitingResponseStudent',
        },
      };
    }

    // Add intakeMonth and intakeYear filters if they are provided
    if (data.intakeMonth) {
      query.intakeMonth = data.intakeMonth;
    }
    if (data.intakeYear) {
      query.intakeYear = data.intakeYear;
    }

    // Add status filter if confirmStatus is provided
    if (data.confrimStatus && data.confrimStatus.length > 0) {
      query.status = { $in: data.confrimStatus };
    }

    // Add course level filter if courseLevel is provided
    if (data.courseLevel) {
      query.courseLevel = data.courseLevel;
    }

    // Find applications based on the dynamically constructed query
    const applications = await Application.find(query);

    return applications;
  } catch (error) {
    throw new Error(`Failed to find applications: ${error.message}`);
  }
}

// Function to create a new application
async function createApplication(applicationData) {
  try {
    const application = await Application.create(applicationData);
    return application;
  } catch (err) {
    throw new Error(`Failed to create application: ${err.message}`);
  }
}
const getApplicationByStudentId = async (studentId) => {
  return Application.find({ studentId });
};
// Function to update an application by ID
async function updateApplicationById(id, updateData) {
  try {
    const application = await Application.findByIdAndUpdate(id, updateData, { new: true });
    return application;
  } catch (err) {
    throw new Error(`Failed to update application with ID ${id}: ${err.message}`);
  }
}

async function deleteApplication(applicationId) {
  try {
    const deletedApplication = await Application.findByIdAndDelete(applicationId);
    return deletedApplication;
  } catch (error) {
    throw new Error(`Failed to delete application with ID ${applicationId}`);
  }
}

/**
 * Pipeline totals for the dashboard — one aggregate, one source of truth.
 *
 * Every figure here is derived from the phase an application is CURRENTLY at:
 * the phase marked AwaitingResponseStudent, falling back to isCurrent for
 * records written before that marker was set consistently.
 *
 * That is the correction. The old by-phase count grouped on `isPrevious`, the
 * LAST COMPLETED phase, which is one step behind where an application actually
 * sits — so an application holding a conditional offer was reported under
 * "Submitted" and never counted as an offer, while one already at Confirmation
 * was counted as an offer only by accident.
 *
 * The KPIs and the "Applications by stage" chart both read this, so the card
 * and the chart cannot disagree.
 */
const PIPELINE_PHASES = [
  'Initiated',
  'Submitted',
  'Conditional offer',
  'Unconditional offer',
  'Confirmation',
  'FG/BS',
  'CAS Received',
  'Done',
];
const OFFER_PHASES = ['Conditional offer', 'Unconditional offer'];

/** Aggregation stage that resolves each application's current phase + index. */
const currentPhaseStages = () => [
  {
    $addFields: {
      _cur: {
        $let: {
          vars: {
            awaiting: {
              $arrayElemAt: [
                {
                  $filter: {
                    input: { $ifNull: ['$portalApplicationStatus.applicationPhases', []] },
                    as: 'p',
                    cond: { $eq: ['$$p.phaseState', 'AwaitingResponseStudent'] },
                  },
                },
                0,
              ],
            },
            current: {
              $arrayElemAt: [
                {
                  $filter: {
                    input: { $ifNull: ['$portalApplicationStatus.applicationPhases', []] },
                    as: 'p',
                    cond: { $eq: ['$$p.isCurrent', true] },
                  },
                },
                0,
              ],
            },
          },
          in: { $ifNull: ['$$awaiting.status', '$$current.status'] },
        },
      },
    },
  },
  { $addFields: { _idx: { $indexOfArray: [PIPELINE_PHASES, '$_cur'] } } },
];

const getPipelineTotals = async (startDate, endDate) => {
  const match = { ...LIVE_ONLY };
  if (startDate && endDate) {
    match.createdAt = { $gte: new Date(startDate), $lte: new Date(endDate) };
  }

  const rows = await Application.aggregate([
    { $match: match },
    ...currentPhaseStages(),
    {
      $group: {
        _id: '$_cur',
        count: { $sum: 1 },
        // Past Initiated — the application has actually been submitted
        // somewhere, which is what the card claims to count. The old figure
        // counted applications CREATED, so one still sitting at Initiated,
        // submitted to nobody, was included.
        submitted: { $sum: { $cond: [{ $gte: ['$_idx', 1] }, 1, 0] } },
        // Currently holding an offer and not yet confirmed.
        openOffers: { $sum: { $cond: [{ $in: ['$_cur', OFFER_PHASES] }, 1, 0] } },
      },
    },
  ]);

  const byStage = PIPELINE_PHASES.map((status) => ({
    status,
    count: (rows.find((r) => r._id === status) || {}).count || 0,
  }));

  return {
    byStage,
    submitted: rows.reduce((n, r) => n + r.submitted, 0),
    openOffers: rows.reduce((n, r) => n + r.openOffers, 0),
    total: rows.reduce((n, r) => n + r.count, 0),
  };
};

/**
 * The records behind one KPI, for its drill-down. Same predicates as the
 * totals above, so a card and the list it opens can never disagree.
 */
const getPipelineDrilldown = async (metric, startDate, endDate) => {
  const match = { ...LIVE_ONLY };
  if (startDate && endDate) {
    match.createdAt = { $gte: new Date(startDate), $lte: new Date(endDate) };
  }

  const post =
    // eslint-disable-next-line no-nested-ternary
    metric === 'offers'
      ? { $match: { _cur: { $in: OFFER_PHASES } } }
      : metric === 'submitted'
      ? { $match: { _idx: { $gte: 1 } } }
      : null;
  if (!post) return [];

  return Application.aggregate([
    { $match: match },
    ...currentPhaseStages(),
    post,
    { $lookup: { from: 'students', localField: 'studentId', foreignField: '_id', as: '_stu' } },
    { $unwind: { path: '$_stu', preserveNullAndEmptyArrays: true } },
    // The counsellor's name, for the row's second line and the record panel's
    // info grid. One lookup on the whole result set rather than a request per
    // row once a panel is opened.
    { $lookup: { from: 'users', localField: '_stu.assignedTo.user', foreignField: '_id', as: '_team' } },
    // Who created the student: the partner organisation, when one did.
    { $lookup: { from: 'users', localField: '_stu.createdBy', foreignField: '_id', as: '_owner' } },
    { $unwind: { path: '$_owner', preserveNullAndEmptyArrays: true } },
    // The course row, for the panel's VALUE cell. `course` is an autopopulate
    // ref, and autopopulate does not run inside an aggregate — so the join is
    // explicit here.
    { $lookup: { from: 'courses', localField: 'course', foreignField: '_id', as: '_course' } },
    { $unwind: { path: '$_course', preserveNullAndEmptyArrays: true } },
    { $sort: { createdAt: -1 } },
    { $limit: 500 },
    {
      $project: {
        _id: 1,
        applicationId: 1,
        courseName: 1,
        courseLevel: 1,
        intakeMonth: 1,
        intakeYear: 1,
        createdAt: 1,
        updatedAt: 1,
        stage: '$_cur',
        institute: { name: '$institute.name', logoUrl: '$institute.logoUrl' },
        studentId: '$_stu._id',
        studentName: { $concat: [{ $ifNull: ['$_stu.firstName', ''] }, ' ', { $ifNull: ['$_stu.lastName', ''] }] },
        // Everything below feeds the record panel opened from a row.
        studentEmail: '$_stu.email',
        studentPhone: '$_stu.phoneNo',
        studentCity: '$_stu.city',
        studentStage: '$_stu.stage',
        studentCreatedAt: '$_stu.createdAt',
        channel: '$_stu.channel',
        testScore: '$_stu.testScore',
        testTaken: '$_stu.testTaken',
        counselors: '$_team.name',
        courseFee: '$_course.approxAnnualFee',
        courseCurrency: '$_course.currency',
        partner: '$_owner.organisation',
      },
    },
  ]);
};

const getApplicationsCountByPhase = async (startDate, endDate) => {
  try {
    // Get all unique phases
    const allPhases = await Application.distinct('portalApplicationStatus.applicationPhases.status');
    const matchStage = {
      $match: {
        'portalApplicationStatus.applicationPhases.isPrevious': true,
        ...LIVE_ONLY,
      },
    };

    if (startDate && endDate) {
      matchStage.$match.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    }
    const result = await Application.aggregate([
      matchStage,
      { $unwind: '$portalApplicationStatus.applicationPhases' },
      { $match: { 'portalApplicationStatus.applicationPhases.isPrevious': true } },
      {
        $group: {
          _id: '$portalApplicationStatus.applicationPhases.status',
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
    ]);

    // Convert the result into a dictionary for easy lookup
    const counts = result.reduce((acc, { _id, count }) => {
      acc[_id] = count;
      return acc;
    }, {});

    // Ensure all phases are included with count of 0 if not present in the result
    const output = allPhases.map((phase) => ({
      status: phase,
      count: counts[phase] || 0,
    }));

    return output;
  } catch (error) {
    throw new Error(`Error fetching current application counts by phase: ${error.message}`);
  }
};

// Applications whose CURRENT phase is Initiated or Submitted (the only phases
// with an SLA). Returns the minimal fields the frontend SLA engine needs to
// compute business-time overdue (see uapply-crm src/utilities/sla.ts).
/**
 * Applications the dashboard's overdue count has to weigh.
 *
 * The candidate phases come from the SLA SETTINGS rather than a hardcoded
 * pair. They used to be fixed as Initiated/Submitted — the only two phases
 * that had an allowance when the thresholds were compiled in — so an admin
 * giving, say, Conditional offer a 14-day limit would see the pipeline flag it
 * while this count silently ignored it, and the two figures would contradict
 * each other on screen.
 *
 * `createdDate` is projected because it is the real "entered this phase"
 * stamp; without it the client falls back to the application's `updatedAt`,
 * which any unrelated write bumps — so the dashboard would age applications
 * differently from the pipeline reading the same records.
 */
const getOverdueCandidateApplications = async () => {
  // eslint-disable-next-line global-require
  const { slaSettingService } = require('.');
  let statuses = ['Initiated', 'Submitted'];
  try {
    const settings = await slaSettingService.getSettings();
    const configured = (settings.phases || []).filter((p) => p.value > 0).map((p) => p.status);
    if (configured.length) statuses = configured;
  } catch (err) {
    // Fall back to the shipped pair rather than counting nothing.
    logger.error(`SLA settings unavailable for the overdue count: ${err.message}`);
  }

  // An aggregate, not a find(): these rows are counted for the KPI AND listed in
  // the drill-down behind it, and a list needs the student, the university and
  // the phase the find() projection never carried. The phases stay in the
  // projection because whether a row is actually overdue is decided on the
  // client, against the SLA config it already holds.
  return Application.aggregate([
    {
      $match: {
        ...LIVE_ONLY,
        'portalApplicationStatus.applicationPhases': {
          $elemMatch: {
            status: { $in: statuses },
            phaseState: 'AwaitingResponseStudent',
          },
        },
      },
    },
    ...currentPhaseStages(),
    { $lookup: { from: 'students', localField: 'studentId', foreignField: '_id', as: '_stu' } },
    { $unwind: { path: '$_stu', preserveNullAndEmptyArrays: true } },
    { $lookup: { from: 'users', localField: '_stu.assignedTo.user', foreignField: '_id', as: '_team' } },
    { $lookup: { from: 'users', localField: '_stu.createdBy', foreignField: '_id', as: '_owner' } },
    { $unwind: { path: '$_owner', preserveNullAndEmptyArrays: true } },
    // The course row, for the panel's VALUE cell. `course` is an autopopulate
    // ref, and autopopulate does not run inside an aggregate — so the join is
    // explicit here.
    { $lookup: { from: 'courses', localField: 'course', foreignField: '_id', as: '_course' } },
    { $unwind: { path: '$_course', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        courseLevel: 1,
        courseName: 1,
        intakeMonth: 1,
        intakeYear: 1,
        createdAt: 1,
        updatedAt: 1,
        stage: '$_cur',
        institute: { name: '$institute.name', logoUrl: '$institute.logoUrl' },
        studentId: '$_stu._id',
        studentName: { $concat: [{ $ifNull: ['$_stu.firstName', ''] }, ' ', { $ifNull: ['$_stu.lastName', ''] }] },
        studentEmail: '$_stu.email',
        studentPhone: '$_stu.phoneNo',
        studentCity: '$_stu.city',
        studentCreatedAt: '$_stu.createdAt',
        channel: '$_stu.channel',
        testScore: '$_stu.testScore',
        testTaken: '$_stu.testTaken',
        counselors: '$_team.name',
        courseFee: '$_course.approxAnnualFee',
        courseCurrency: '$_course.currency',
        partner: '$_owner.organisation',
        'portalApplicationStatus.applicationPhases.status': 1,
        'portalApplicationStatus.applicationPhases.phaseState': 1,
        'portalApplicationStatus.applicationPhases.isCurrent': 1,
        'portalApplicationStatus.applicationPhases.createdDate': 1,
      },
    },
  ]);
};

const getTopUniversitiesByApplications = async (startDate, endDate, limit = 10) => {
  try {
    const matchStage = { ...LIVE_ONLY };

    if (startDate && endDate) {
      matchStage.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    }
    const universities = await Application.aggregate([
      { $match: matchStage },
      // Only applications belonging to Applied/Enrolled students.
      { $lookup: { from: 'students', localField: 'studentId', foreignField: '_id', as: '_stu' } },
      { $match: { '_stu.stage': { $in: ['Applied', 'Enrolled'] } } },
      { $group: { _id: '$institute', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: limit },

      {
        $project: {
          name: '$institute.name',
          count: 1,
        },
      },
    ]);

    return universities;
  } catch (error) {
    throw new Error(`Error fetching current application counts by phase: ${error.message}`);
  }
};

// Intake demand — applications of Applied/Enrolled students, grouped by the
// application's intake (intakeYear/intakeMonth).
const getApplicationsByIntake = async () => {
  return Application.aggregate([
    { $lookup: { from: 'students', localField: 'studentId', foreignField: '_id', as: '_stu' } },
    {
      $match: {
        ...LIVE_ONLY,
        '_stu.stage': { $in: ['Applied', 'Enrolled'] },
        intakeMonth: { $nin: [null, ''] },
      },
    },
    { $group: { _id: { year: '$intakeYear', month: '$intakeMonth' }, count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 8 },
  ]);
};

const getTopEnrolledUniversities = async (startDate, endDate) => {
  const matchStage = {
    ...LIVE_ONLY,
    $and: [
      { 'portalApplicationStatus.applicationPhases.isPrevious': true },
      { 'portalApplicationStatus.applicationPhases.status': 'Done' },
    ],
  };

  if (startDate && endDate) {
    matchStage.createdAt = {
      $gte: new Date(startDate),
      $lte: new Date(endDate),
    };
  }

  const pipeline = [
    // Step 1: Unwind the applicationPhases array
    {
      $unwind: '$portalApplicationStatus.applicationPhases',
    },
    // Step 2: Match documents where the phase meets the criteria
    { $match: matchStage },
    // Step 3: Group by university name and count the matches
    {
      $group: {
        _id: '$institute', // Group by the university name
        count: { $sum: 1 }, // Count the number of documents
      },
    },
    // Step 4: Sort the results by count in descending order
    {
      $sort: { count: -1 },
    },
  ];

  try {
    const results = await Application.aggregate(pipeline).exec();

    // Transform results to the desired output format
    return results.map((result) => ({
      institute: result._id,
      count: result.count,
    }));
  } catch (error) {
    throw new Error(`Error fetching top enrolled universities: ${error.message}`);
  }
};

const getEnrolledApplicationsCountByMonth = async (intakeMonth, intakeYear) => {
  const currentYear = new Date().getFullYear();

  const matchStage = {
    ...LIVE_ONLY,
    $and: [
      { 'portalApplicationStatus.applicationPhases.isPrevious': true },
      { 'portalApplicationStatus.applicationPhases.status': 'Done' },
    ],
    createdAt: {
      $gte: new Date(currentYear, 0, 1),
      $lte: new Date(currentYear, 11, 31),
    },
  };

  // If intakeYear and intakeMonth are provided, add them to the match criteria
  if (intakeYear && intakeMonth) {
    matchStage.intakeYear = parseInt(intakeYear, 10);
    matchStage.intakeMonth = intakeMonth;
  }

  const monthlySums = await Application.aggregate([
    {
      $unwind: '$portalApplicationStatus.applicationPhases',
    },
    {
      $match: matchStage,
    },
    {
      $addFields: {
        month: { $month: '$createdAt' },
        year: { $year: '$createdAt' },
      },
    },
    {
      $group: {
        _id: { month: '$month' },
        count: { $sum: 1 },
      },
    },
    {
      $project: {
        _id: 0,
        month: '$_id.month',
        count: 1,
      },
    },
    {
      $sort: { month: 1 },
    },
  ]);

  // Generate an array of all possible months (1 to 12)
  const allMonths = Array.from({ length: 12 }, (_, i) => i + 1);

  // Create a map to store existing counts for quick lookup
  const countMap = new Map();
  monthlySums.forEach((item) => {
    countMap.set(item.month, item.count);
  });

  // Create an array to hold the final result
  const result = [];

  allMonths.forEach((month) => {
    const count = countMap.get(month) || 0;
    result.push({ year: currentYear, month, count });
  });

  return result;
};

const getApplicationsCountByMonth = async (intakeMonth, intakeYear) => {
  const currentYear = new Date().getFullYear();

  const matchStage = {
    $match: {
      ...LIVE_ONLY,
      createdAt: {
        $gte: new Date(currentYear, 0, 1),
        $lte: new Date(currentYear, 11, 31),
      },
    },
  };

  if (intakeMonth && intakeYear) {
    matchStage.$match.intakeMonth = intakeMonth;
    matchStage.$match.intakeYear = parseInt(intakeYear, 10);
  }

  const monthlySums = await Application.aggregate([
    matchStage,
    {
      $addFields: {
        month: { $month: '$createdAt' }, // Extract month from createdDate
        year: { $year: '$createdAt' }, // Extract year from createdDate
      },
    },
    {
      $group: {
        _id: { month: '$month' },
        bookingCount: { $sum: 1 }, // Count the number of documents (applications)
      },
    },
    {
      $project: {
        _id: 0,
        month: '$_id.month',
        bookingCount: 1,
      },
    },
    {
      $sort: { month: 1 },
    },
  ]);

  // Generate an array of all possible months (1 to 12)
  const allMonths = Array.from({ length: 12 }, (_, i) => i + 1);

  // Create a map to store existing sums and counts for quick lookup
  const sumMap = new Map();
  monthlySums.forEach((item) => {
    sumMap.set(item.month, { bookingCount: item.bookingCount });
  });

  // Create an array to hold the final result
  const result = [];

  allMonths.forEach((month) => {
    const { bookingCount = 0 } = sumMap.get(month) || {};
    result.push({ year: currentYear, month, bookingCount });
  });

  return result;
};

// Buckets an application's course level (either a courselevels ObjectId string
// resolved to en_name, or an already-readable string) into the four dashboard
// levels. Mirrors bucketCourseLevel in students.service.js.
const bucketApplicationLevel = (name) => {
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

// Top universities broken down by course level, so the dashboard's "Top 5
// universities" card can filter by degree level client-side. Returns one row
// per (university, level) pair; the frontend re-aggregates for the active
// filter. `level` may be null when the course level can't be classified.
const getTopUniversitiesByLevel = async (startDate, endDate) => {
  const matchStage = { ...LIVE_ONLY };
  if (startDate && endDate) {
    matchStage.createdAt = { $gte: new Date(startDate), $lte: new Date(endDate) };
  }
  const rows = await Application.aggregate([
    { $match: matchStage },
    // No student-stage gate. This used to require the STUDENT to be at
    // Applied/Enrolled, which has nothing to do with whether a foundation
    // application exists: a student whose first application was just created
    // is still at NotApplied, and a partner-referred one sits at
    // PendingReview — so their placements were invisible and the card read
    // empty on exactly the data most likely to be in it.
    {
      $addFields: {
        _lvlOid: {
          $convert: { input: '$courseLevel', to: 'objectId', onError: null, onNull: null },
        },
      },
    },
    { $lookup: { from: 'courselevels', localField: '_lvlOid', foreignField: '_id', as: '_lvl' } },
    {
      $group: {
        _id: {
          uni: '$institute.name',
          rawLevel: '$courseLevel',
          levelName: { $arrayElemAt: ['$_lvl.en_name', 0] },
        },
        logoUrl: { $first: '$institute.logoUrl' },
        count: { $sum: 1 },
      },
    },
  ]);
  return rows
    .filter((r) => r._id.uni)
    .map((r) => ({
      name: r._id.uni,
      logoUrl: r.logoUrl || null,
      level: bucketApplicationLevel(r._id.levelName || r._id.rawLevel),
      count: r.count,
    }));
};

// Foundation placements — Foundation-level applications (of Applied/Enrolled
// students) grouped into provider -> university pairs. Powers the "Foundation
// placements" card and its provider multi-select.
const getFoundationPlacements = async (startDate, endDate) => {
  const matchStage = { ...LIVE_ONLY };
  if (startDate && endDate) {
    matchStage.createdAt = { $gte: new Date(startDate), $lte: new Date(endDate) };
  }
  const rows = await Application.aggregate([
    { $match: matchStage },
    { $lookup: { from: 'students', localField: 'studentId', foreignField: '_id', as: '_stu' } },
    { $match: { '_stu.stage': { $in: ['Applied', 'Enrolled'] } } },
    {
      $addFields: {
        _lvlOid: {
          $convert: { input: '$courseLevel', to: 'objectId', onError: null, onNull: null },
        },
      },
    },
    { $lookup: { from: 'courselevels', localField: '_lvlOid', foreignField: '_id', as: '_lvl' } },
    {
      $group: {
        _id: {
          provider: '$provider',
          uni: '$institute.name',
          rawLevel: '$courseLevel',
          levelName: { $arrayElemAt: ['$_lvl.en_name', 0] },
        },
        logoUrl: { $first: '$institute.logoUrl' },
        count: { $sum: 1 },
      },
    },
  ]);
  // Keep only Foundation-level rows and merge any duplicate provider/uni pairs
  // that arrived under different raw course-level ids.
  const merged = {};
  const logos = {};
  rows.forEach((r) => {
    if (bucketApplicationLevel(r._id.levelName || r._id.rawLevel) !== 'Foundation') return;
    const { uni } = r._id;
    // Courses without a pathway provider store the literal "N/A", which is
    // truthy — so those rows survived and the card listed a provider called
    // "N/A" alongside the real ones.
    const raw = String(r._id.provider || '').trim();
    const provider = raw && raw.toUpperCase() !== 'N/A' ? raw : '';
    if (!provider || !uni) return;
    const key = `${provider}|${uni}`;
    merged[key] = (merged[key] || 0) + r.count;
    if (!logos[key] && r.logoUrl) logos[key] = r.logoUrl;
  });
  return Object.entries(merged)
    .map(([key, count]) => {
      const [provider, uni] = key.split('|');
      return { provider, uni, logoUrl: logos[key] || null, count };
    })
    .sort((a, b) => b.count - a.count);
};

async function getDashboardData({ startDate, endDate, intakeMonth, intakeYear }) {
  try {
    // Fetch the data from individual functions
    const topEnrolledUniversities = await getTopEnrolledUniversities(startDate, endDate);
    const applicationsCountByMonth = await getApplicationsCountByMonth(intakeMonth, intakeYear);
    const enrolledApplicationsCountByMonth = await getEnrolledApplicationsCountByMonth(intakeMonth, intakeYear);
    const topUniversitiesByApplications = await getTopUniversitiesByApplications(startDate, endDate);
    // Applications-by-stage (drives "Offers received" KPI + "Applications by
    // stage" graph) and the overdue-candidate feed for the "Overdue" KPI.
    // One aggregate feeds the KPIs AND the by-stage chart; see getPipelineTotals
    // for why the old isPrevious-based count was a phase behind.
    const pipelineTotals = await getPipelineTotals(startDate, endDate);
    const applicationsCountByPhase = pipelineTotals.byStage;
    const overdueCandidates = await getOverdueCandidateApplications();
    const applicationsByIntake = await getApplicationsByIntake();
    // Degree-level breakdown for the "Top 5 universities" filter, and the
    // provider -> university pairs for the "Foundation placements" card.
    const topUniversitiesByLevel = await getTopUniversitiesByLevel(startDate, endDate);
    const foundationPlacements = await getFoundationPlacements(startDate, endDate);

    // Combine the results into a single object
    return {
      topEnrolledUniversities,
      applicationsCountByMonth,
      enrolledApplicationsCountByMonth,
      topUniversitiesByApplications,
      applicationsCountByPhase,
      pipelineTotals,
      overdueCandidates,
      applicationsByIntake,
      topUniversitiesByLevel,
      foundationPlacements,
    };
  } catch (error) {
    throw new Error(`Failed to retrieve dashboard data: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Sub-agent ownership + counsellor review
//
// Every function here puts the ownership predicate INSIDE the Mongo query.
// Fetching broadly and filtering the array afterwards would mean the other
// agents' documents were read out of the database in the first place, which is
// exactly the leak this feature has to close.
// ---------------------------------------------------------------------------

// Applications created by one user. `ownerId` is always taken from the
// authenticated session, never from a query parameter.
const getApplicationsForOwner = async (ownerId, { reviewStatus, limit = 200 } = {}) => {
  if (!ownerId) return [];
  const query = { createdBy: ownerId };
  if (reviewStatus) query.reviewStatus = Array.isArray(reviewStatus) ? { $in: reviewStatus } : reviewStatus;
  return Application.find(query).sort({ createdAt: -1 }).limit(limit);
};

// One application, but only if `ownerId` created it. Returns null otherwise so
// the caller can answer 404 rather than 403 -- a sub-agent probing ids should
// not be able to tell "exists but not yours" from "does not exist".
const getApplicationForOwner = async (applicationId, ownerId) => {
  if (!ownerId) return null;
  return Application.findOne({ _id: applicationId, createdBy: ownerId });
};

// Applications a sub-agent submitted for one of their students. Used by the
// portal's per-student view.
const getApplicationsByStudentForOwner = async (studentId, ownerId) => {
  if (!ownerId) return [];
  return Application.find({ studentId, createdBy: ownerId }).sort({ createdAt: -1 });
};

/**
 * Applications for every student a school counsellor owns.
 *
 * Ownership is the STUDENT's (createdBy / assignedTo), not the application's:
 * Ulearn staff create applications for referred students, so filtering on
 * application.createdBy would hide exactly the records the counsellor is
 * waiting on. The caller passes the student ids it has already scoped.
 */
const getApplicationsForStudents = async (studentIds, { limit = 200 } = {}) => {
  if (!studentIds || !studentIds.length) return [];
  return Application.find({ studentId: { $in: studentIds } })
    .sort({ createdAt: -1 })
    .limit(limit);
};

// Every partner submission awaiting a decision, newest first. Both partner
// states are queued together — a reviewer works one list, and the status tells
// them which portal it came from.
const PENDING_REVIEW_STATES = ['SUBMITTED_BY_SUBAGENT', 'SUBMITTED_BY_COUNSELOR'];

const getApplicationsPendingReview = async ({ limit = 200 } = {}) => {
  return Application.find({ reviewStatus: { $in: PENDING_REVIEW_STATES } })
    .sort({ createdAt: -1 })
    .limit(limit);
};

// Which review transitions are legal. Anything not listed is rejected, so a
// crafted reviewStatus in a request body cannot move an application sideways
// (e.g. straight from REJECTED back to APPROVED without a resubmission).
const REVIEW_TRANSITIONS = {
  SUBMITTED_BY_SUBAGENT: ['APPROVED', 'REJECTED', 'RETURNED_FOR_EDIT'],
  // A school counsellor may not resubmit (they get no edit affordance at all,
  // per the requirement), so RETURNED_FOR_EDIT is deliberately NOT offered for
  // their submissions — a reviewer approves or rejects.
  SUBMITTED_BY_COUNSELOR: ['APPROVED', 'REJECTED'],
  RETURNED_FOR_EDIT: ['SUBMITTED_BY_SUBAGENT'],
  REJECTED: [],
  APPROVED: [],
  DRAFT: ['SUBMITTED_BY_SUBAGENT'],
};

const canTransition = (from, to) => (REVIEW_TRANSITIONS[from] || []).includes(to);

// Apply a review decision and append to the append-only decision log. Uses a
// conditional update on the CURRENT reviewStatus so two counsellors clicking
// Approve and Reject at the same moment cannot both win.
const applyReviewDecision = async (applicationId, { from, to, action, by, byName, note }) => {
  const updated = await Application.findOneAndUpdate(
    { _id: applicationId, reviewStatus: from },
    {
      $set: { reviewStatus: to },
      $push: { reviewHistory: { action, by, byName, note, at: new Date() } },
    },
    { new: true }
  );

  /**
   * Approval starts the SLA clock.
   *
   * A partner-submitted application is stamped when the PARTNER creates it,
   * but it is excluded from every staff view until a reviewer approves it
   * (see LIVE_ONLY). Left as-is, the time Ulearn spent reviewing was charged
   * against the phase's allowance — and since the opening phase allows four
   * business hours, an application approved the next morning would appear on
   * the board already red, for a delay no one could have acted on. The clock
   * now starts when the work actually becomes actionable.
   */
  if (updated && to === 'APPROVED') {
    const phases = (updated.portalApplicationStatus && updated.portalApplicationStatus.applicationPhases) || [];
    let i = phases.findIndex((p) => p && p.phaseState === 'AwaitingResponseStudent');
    if (i === -1) i = phases.findIndex((p) => p && p.isCurrent);
    if (i !== -1) {
      phases[i].createdDate = new Date();
      updated.markModified('portalApplicationStatus');
      await updated.save();
    }
  }

  return updated;
};

// Export the functions for use in other files
module.exports = {
  findApplicationById,
  createApplication,
  updateApplicationById,
  getApplications,
  deleteApplication,
  getApplicationByStudentId,
  getPipelineTotals,
  getPipelineDrilldown,
  getApplicationsForOwner,
  getApplicationForOwner,
  getApplicationsByStudentForOwner,
  getApplicationsForStudents,
  getApplicationsPendingReview,
  canTransition,
  applyReviewDecision,
  getApplicationsCountByPhase,
  getOverdueCandidateApplications,
  getTopUniversitiesByApplications,
  getTopEnrolledUniversities,
  getApplicationsCountByMonth,
  getEnrolledApplicationsCountByMonth,
  getDashboardData,
};
