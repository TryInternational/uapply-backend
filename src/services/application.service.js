/* eslint-disable object-shorthand */
/* eslint-disable no-plusplus */
const { Application, Students } = require('../models');
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
/**
 * The student (looked up as `_stu`) applied or enrolled — now, or in an earlier
 * journey. A Foundation student who has moved on to a Bachelor's journey is at
 * "NotApplied" again, and their Foundation applications must not drop out of
 * the stats when that happens.
 */
// Lost counts too: these matches sit AFTER a LIVE application row has been
// found for the student, and a student who applied and was later lost still
// applied — the counsellors always logged them (decided 9 Nov 2026).
const STUDENT_APPLIED_OR_ENROLLED = {
  $or: [
    { '_stu.stage': { $in: ['Applied', 'Enrolled', 'Lost'] } },
    { '_stu.journeys.outcome': { $in: ['Applied', 'Enrolled', 'Lost'] } },
  ],
};

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

    // Only these students' applications (comma list) — the Students list asks for
    // the page it shows instead of every application in the database.
    if (data.studentIds) {
      const ids = String(data.studentIds)
        .split(',')
        .map((x) => x.trim())
        .filter((x) => /^[0-9a-f]{24}$/i.test(x))
        .slice(0, 500);
      query.studentId = { $in: ids };
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

/* ---------------------------------------------------------------------------
   "Needs action" — the two student lists (Dormant 30+ days, IELTS not booked).
   They are about students, not applications, and about right now, not a
   date range. Each row says why the student is on the list.
   ------------------------------------------------------------------------- */
const DORMANT_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_KEYS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** a sortable number for an intake (month name or number + year); Infinity when unknown */
const intakeRank = (month, year) => {
  const y = Number(year);
  if (!y) return Infinity;
  const n = Number(month);
  const m =
    Number.isInteger(n) && n >= 1 && n <= 12
      ? n - 1
      : MONTH_KEYS.indexOf(
          String(month || '')
            .trim()
            .slice(0, 3)
            .toLowerCase()
        );
  return y * 12 + (m < 0 ? 0 : m);
};
/** this month, in Kuwait, on the same scale: an intake at or below it has started (the 1st has passed) */
const kuwaitMonthRank = (now) => {
  const [month, year] = now
    .toLocaleString('en-US', { timeZone: 'Asia/Kuwait', month: 'numeric', year: 'numeric' })
    .split('/')
    .map(Number);
  return year * 12 + (month - 1);
};
const nameKey = (parts) => parts.filter(Boolean).join(' ').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * @param {'dormant'|'ielts'} metric
 *   dormant — students still in the pipeline (not applied yet, or applied) with
 *             nothing recorded for 30 days or more: no change to the student,
 *             no application update, no comment and no timeline entry.
 *             Longest quiet first.
 *   ielts   — applied students whose intake has not started yet (or is not
 *             recorded) with no English test on file (not marked as taken or
 *             waiting for results, no score) and no IELTS booking, matched by
 *             the booking's student link or, for older bookings that have
 *             none, by name. Soonest intake first. A student still marked
 *             Applied for an intake that has begun is past booking a test:
 *             that is the Dormant list's business.
 */
const getStudentDrilldown = async (metric, now = new Date()) => {
  if (metric !== 'dormant' && metric !== 'ielts') return [];
  // required here: these models are only needed for this list
  // eslint-disable-next-line global-require
  const { Comments, Activity, Fees, User } = require('../models');
  const idOf = (x) => String((x && (x._id || x.id)) || x || '');

  const students = await Students.find(
    { stage: { $in: metric === 'ielts' ? ['Applied'] : ['NotApplied', 'Applied'] } },
    {
      firstName: 1,
      middleName: 1,
      lastName: 1,
      stage: 1,
      assignedTo: 1,
      createdAt: 1,
      updatedAt: 1,
      testTaken: 1,
      testScore: 1,
      'englishTest.overall': 1,
      'preference.intakeMonth': 1,
      'preference.intakeYear': 1,
    },
    { autopopulate: false }
  ).lean();
  if (!students.length) return [];
  const ids = students.map((s) => s._id);

  const [apps, team] = await Promise.all([
    Application.find(
      { ...LIVE_ONLY, studentId: { $in: ids } },
      { studentId: 1, createdAt: 1, updatedAt: 1, intakeMonth: 1, intakeYear: 1, courseName: 1, institute: 1 },
      { autopopulate: false }
    ).lean(),
    User.find(
      { _id: { $in: [].concat(...students.map((s) => (s.assignedTo || []).map((a) => a && a.user))).filter(Boolean) } },
      { name: 1 }
    ).lean(),
  ]);
  const teamName = new Map(team.map((u) => [idOf(u), u.name]));
  const appsBy = new Map();
  apps.forEach((a) => appsBy.set(idOf(a.studentId), (appsBy.get(idOf(a.studentId)) || []).concat(a)));
  const stamp = (d) => (d ? new Date(d).getTime() : 0);

  const base = (s) => {
    const list = (appsBy.get(idOf(s)) || []).slice().sort((a, b) => stamp(b.updatedAt) - stamp(a.updatedAt));
    const latest = list[0];
    const pref = s.preference || {};
    const withIntake = list.find((a) => a.intakeMonth && a.intakeYear);
    return {
      _id: idOf(s),
      kind: 'student',
      studentId: idOf(s),
      studentName: [s.firstName, s.lastName].filter(Boolean).join(' '),
      studentStage: s.stage,
      stage: s.stage === 'NotApplied' ? 'Not applied yet' : s.stage,
      counselors: (s.assignedTo || []).map((a) => teamName.get(idOf(a && a.user))).filter(Boolean),
      courseName: latest ? latest.courseName : undefined,
      institute: latest && latest.institute ? { name: latest.institute.name, logoUrl: latest.institute.logoUrl } : undefined,
      applications: list.length,
      intakeMonth: pref.intakeMonth || (withIntake && withIntake.intakeMonth) || undefined,
      intakeYear: pref.intakeYear || (withIntake && withIntake.intakeYear) || undefined,
    };
  };

  if (metric === 'dormant') {
    const [comments, activity] = await Promise.all([
      Comments.aggregate([
        { $match: { studentId: { $in: ids } } },
        { $group: { _id: '$studentId', at: { $max: '$createdAt' } } },
      ]),
      Activity.aggregate([
        { $match: { student: { $in: ids } } },
        { $group: { _id: '$student', at: { $max: '$createdAt' } } },
      ]),
    ]);
    const lastComment = new Map(comments.map((r) => [idOf(r._id), stamp(r.at)]));
    const lastEntry = new Map(activity.map((r) => [idOf(r._id), stamp(r.at)]));
    return students
      .map((s) => {
        const k = idOf(s);
        const last = Math.max(
          stamp(s.updatedAt || s.createdAt),
          ...(appsBy.get(k) || []).map((a) => stamp(a.updatedAt || a.createdAt)),
          lastComment.get(k) || 0,
          lastEntry.get(k) || 0
        );
        return {
          ...base(s),
          lastActivityAt: last ? new Date(last) : null,
          quietDays: Math.floor((now.getTime() - last) / DAY_MS),
        };
      })
      .filter((r) => r.lastActivityAt && r.quietDays >= DORMANT_DAYS)
      .sort((a, b) => b.quietDays - a.quietDays);
  }

  // ielts
  const bookings = await Fees.find({ feeType: 'ielts-booking' }, { student: 1, 'tag.fullName': 1 }).lean();
  const booked = new Set(bookings.map((f) => idOf(f.student)).filter(Boolean));
  const bookedNames = new Set(bookings.map((f) => nameKey([f.tag && f.tag.fullName])).filter(Boolean));
  const hasTest = (s) =>
    s.testTaken === 'Yes' ||
    s.testTaken === 'Waiting for results' ||
    !!s.testScore ||
    !!(s.englishTest && s.englishTest.overall);
  const hasBooking = (s) =>
    booked.has(idOf(s)) ||
    bookedNames.has(nameKey([s.firstName, s.middleName, s.lastName])) ||
    bookedNames.has(nameKey([s.firstName, s.lastName]));
  const thisMonth = kuwaitMonthRank(now);
  return students
    .filter((s) => !hasTest(s) && !hasBooking(s))
    .map(base)
    .filter((r) => intakeRank(r.intakeMonth, r.intakeYear) > thisMonth)
    .sort(
      (a, b) =>
        intakeRank(a.intakeMonth, a.intakeYear) - intakeRank(b.intakeMonth, b.intakeYear) ||
        a.studentName.localeCompare(b.studentName)
    );
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
    // a stage counts when it has an allowance, or one for any degree level
    const hasSla = (p) => p.value > 0 || Object.values(p.levels || {}).some((v) => typeof v === 'number' && v > 0);
    const configured = (settings.phases || []).filter(hasSla).map((p) => p.status);
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
  const rows = await Application.aggregate([
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
    // Nobody is working a rejected application, or one whose student is Lost /
    // Denied (or deleted): those have no clock, so they are not "overdue".
    // Nor one whose student has ENROLLED: the offers they did not take are
    // finished business, yet they were 467 of the 1,234 rows weighed here.
    {
      $match: {
        rejected: { $ne: true },
        '_stu._id': { $exists: true },
        '_stu.stage': { $nin: ['Lost', 'Denied', 'Enrolled'] },
      },
    },
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
        studentIntakeMonth: '$_stu.preference.intakeMonth',
        studentIntakeYear: '$_stu.preference.intakeYear',
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
  // An application for an intake that has already begun is past chasing: the
  // student went, or did not. They were 418 of the 767 rows — every September
  // 2026 application still sitting at Submitted — and kept the count high
  // whatever the team did. The application's own intake decides, else the
  // student's; one with no intake recorded stays in.
  const thisMonth = kuwaitMonthRank(new Date());
  return rows.filter((a) => {
    const rank =
      a.intakeMonth && a.intakeYear
        ? intakeRank(a.intakeMonth, a.intakeYear)
        : intakeRank(a.studentIntakeMonth, a.studentIntakeYear);
    return rank > thisMonth;
  });
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
      { $match: STUDENT_APPLIED_OR_ENROLLED },
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
        ...STUDENT_APPLIED_OR_ENROLLED,
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
      // up to (not including) 1 Jan next year — `$lte: 31 Dec 00:00` left 31 Dec out
      createdAt: {
        $gte: new Date(currentYear, 0, 1),
        $lt: new Date(currentYear + 1, 0, 1),
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

/**
 * "Students who applied" per month, this year and last year: every student
 * counts ONCE PER INTAKE they applied for, in the month (Kuwait time) of their
 * first LIVE application for that intake — a student who applied for
 * September, did not go, and applied again for January counts twice, the way
 * a counsellor logs it. Replaces the old pairing of applications-this-year
 * with the manual "+ Log" tally for last year, which compared two different
 * things. Checked against the counsellors' log for 2025–2026: same shape month
 * by month, the log ~8% higher (entries with no matching card).
 */
const KUWAIT_TZ = 'Asia/Kuwait';
const kuwaitYearOf = (d) => Number(new Date(d).toLocaleString('en-US', { timeZone: KUWAIT_TZ, year: 'numeric' }));

/**
 * Each student's first LIVE application per intake (`first` = its createdAt);
 * applications without an intake fall into one bucket per student; students
 * since deleted are left out.
 */
const firstLiveApplications = () => [
  { $match: { ...LIVE_ONLY, studentId: { $ne: null } } },
  {
    $group: {
      _id: {
        student: '$studentId',
        intakeYear: { $ifNull: ['$intakeYear', null] },
        intakeMonth: { $ifNull: ['$intakeMonth', null] },
      },
      first: { $min: '$createdAt' },
    },
  },
  { $lookup: { from: 'students', localField: '_id.student', foreignField: '_id', as: '_s' } },
  { $match: { '_s.0': { $exists: true } } },
  // an application prepared while the student is still a lead (NotApplied, never
  // moved) is not an application yet — on Trello, a checklist on a 🔥 Hot card
  {
    $match: {
      $or: [{ '_s.0.stage': { $ne: 'NotApplied' } }, { '_s.0.appliedAt': { $ne: null } }],
    },
  },
  { $project: { _s: 0 } },
];

/**
 * Every "applied" event, the way a counsellor would log it:
 *   · each student once per intake they applied for, dated by the first live
 *     application for that intake;
 *   · a student (or an earlier journey) marked applied with no university
 *     application at all counts once, at the stage move (`appliedAt`) — on
 *     Trello that was a card moved out of 🔥 Hot without a checklist.
 */
const appliedEvents = async () => {
  const perIntake = await Application.aggregate([
    ...firstLiveApplications(),
    { $project: { student: '$_id.student', at: '$first' } },
  ]);
  const withApps = new Set(perIntake.map((r) => String(r.student)));
  const events = perIntake.map((r) => ({ student: r.student, at: new Date(r.at) }));
  const marked = await Students.find(
    { $or: [{ appliedAt: { $ne: null } }, { 'journeys.appliedAt': { $ne: null } }] },
    { appliedAt: 1, applications: 1, journeys: 1 },
    { autopopulate: false }
  ).lean();
  marked.forEach((st) => {
    const currentApps = Array.isArray(st.applications) ? st.applications.length : 0;
    if (st.appliedAt && !currentApps && !withApps.has(String(st._id)))
      events.push({ student: st._id, at: new Date(st.appliedAt) });
    (st.journeys || []).forEach((j) => {
      if (j && j.appliedAt && !(Array.isArray(j.applications) && j.applications.length))
        events.push({ student: st._id, at: new Date(j.appliedAt) });
    });
  });
  return events;
};

/**
 * Students who applied between two instants (the pulse on the counselor desk):
 * the applied events above, inside the range.
 */
const countAppliedStudents = async (startDate, endDate) => {
  const s = new Date(startDate);
  const e = new Date(endDate);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return 0;
  const events = await appliedEvents();
  return events.filter((ev) => ev.at >= s && ev.at <= e).length;
};

/**
 * THE rule for "students who applied in a period", shared by the applied
 * chart, the Sales panel, Team rankings and the Stats tab: the distinct
 * students with an applied event (above) between the two instants. With no
 * (valid) range, every student who has ever applied.
 *
 * The cards used to disagree — Sales counted a student's first-EVER
 * application, Team rankings any application created in the range, the Stats
 * tab the students ADDED in the range — so the same person read 26 on one tab
 * and 19 on the next.
 *
 * Returns a Map of student id → WHEN they applied (their earliest applied
 * event in the range). "Offers" and "Enrolled" of these students are counted
 * from that moment on: a student back for a new intake brought an enrolment
 * from an earlier year with them, which read as 8% conversion beside 0 enrolled.
 */
const appliedStudentsBetween = async (startDate, endDate) => {
  const s = startDate ? new Date(startDate) : null;
  const e = endDate ? new Date(endDate) : null;
  const ranged = !!s && !!e && !Number.isNaN(s.getTime()) && !Number.isNaN(e.getTime());
  const events = await appliedEvents();
  const first = new Map();
  events.forEach((ev) => {
    if (ranged && !(ev.at >= s && ev.at <= e)) return;
    const k = String(ev.student);
    const prev = first.get(k);
    if (!prev || ev.at < prev) first.set(k, ev.at);
  });
  return first;
};

/** The ids of `appliedStudentsBetween` (every card's "students who applied"). */
const appliedStudentIdsBetween = async (startDate, endDate) =>
  Array.from((await appliedStudentsBetween(startDate, endDate)).keys());

const kuwaitYMD = (date) => {
  const [m, d, y] = new Date(date)
    .toLocaleString('en-US', { timeZone: KUWAIT_TZ, month: 'numeric', day: 'numeric', year: 'numeric' })
    .split('/');
  return { y: Number(y), m: Number(m), d: Number(d) };
};

/**
 * @param {number} [year] the year shown (Kuwait); defaults to the current one, so
 *   a range in an earlier year ("Last year") gets that year and the one before it
 * @param {Date} [now]
 *
 * `lastYearToDay[m]` is last year's month m up to today's day of the month —
 * what "Same time last year" needs for the month in progress. The card used to
 * estimate it (last year's whole month × the share of the month gone).
 */
const getAppliedStudentsByMonth = async (year, now = new Date()) => {
  const thisYear = Number(year) || kuwaitYearOf(now);
  const today = kuwaitYMD(now).d;
  const events = (await appliedEvents()).map((ev) => kuwaitYMD(ev.at));
  const series = (y, uptoDay = 31) => {
    const out = Array.from({ length: 12 }, () => 0);
    events.forEach((ev) => {
      if (ev.y === y && ev.d <= uptoDay) out[ev.m - 1] += 1;
    });
    return out;
  };
  return {
    year: thisYear,
    thisYear: series(thisYear),
    lastYear: series(thisYear - 1),
    lastYearToDay: series(thisYear - 1, today),
  };
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
    { $match: STUDENT_APPLIED_OR_ENROLLED },
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
    // Eleven independent aggregates: run them side by side. They used to be
    // awaited one after another, so the card waited for the SUM of them.
    const [
      topEnrolledUniversities,
      applicationsCountByMonth,
      appliedStudentsByMonth,
      enrolledApplicationsCountByMonth,
      topUniversitiesByApplications,
      // one aggregate feeds the KPIs AND the by-stage chart; see getPipelineTotals
      // for why the old isPrevious-based count was a phase behind
      pipelineTotals,
      overdueCandidates,
      applicationsByIntake,
      // degree-level breakdown for "Top 5 universities"; provider -> university pairs
      topUniversitiesByLevel,
      foundationPlacements,
    ] = await Promise.all([
      getTopEnrolledUniversities(startDate, endDate),
      getApplicationsCountByMonth(intakeMonth, intakeYear),
      getAppliedStudentsByMonth(endDate ? kuwaitYearOf(endDate) : undefined),
      getEnrolledApplicationsCountByMonth(intakeMonth, intakeYear),
      getTopUniversitiesByApplications(startDate, endDate),
      getPipelineTotals(startDate, endDate),
      getOverdueCandidateApplications(),
      getApplicationsByIntake(),
      getTopUniversitiesByLevel(startDate, endDate),
      getFoundationPlacements(startDate, endDate),
    ]);
    const applicationsCountByPhase = pipelineTotals.byStage;

    // Combine the results into a single object
    return {
      topEnrolledUniversities,
      applicationsCountByMonth,
      appliedStudentsByMonth,
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
  LIVE_ONLY,
  PIPELINE_PHASES,
  currentPhaseStages,
  findApplicationById,
  createApplication,
  updateApplicationById,
  getApplications,
  deleteApplication,
  getApplicationByStudentId,
  getPipelineTotals,
  getPipelineDrilldown,
  getStudentDrilldown,
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
  getAppliedStudentsByMonth,
  countAppliedStudents,
  appliedStudentsBetween,
  appliedStudentIdsBetween,
  firstLiveApplications,
  getDashboardData,
};
