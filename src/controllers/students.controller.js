/* eslint-disable no-nested-ternary */
const httpStatus = require('http-status');
const mongoose = require('mongoose');
const { DateTime } = require('luxon');
const axios = require('axios');
const { dmEnabled: slackDmEnabled } = require('../thirdparty/slack');
const { convertASTToUTC } = require('../utils/Common');
// const { text } = require('express');
const pick = require('../utils/pick');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');
const { studentsService, userService, notificationsService, activitiesService } = require('../services');
const { isSubAgent, isSchoolCounselor, isExternalPartner } = require('../middlewares/subAgentScope');
const { Students, Application } = require('../models');
const logger = require('../config/logger');
const { actorOf } = require('../utils/actor');

const SLACK_API_URL = 'https://slack.com/api/chat.postMessage';
const SLACK_TOKEN = process.env.SLACK_NOTIFICATION;

const sendSlackNotification = async (memberId, slackBody) => {
  // Production only — see thirdparty/slack.js.
  if (!slackDmEnabled) return;
  try {
    const response = await axios.post(
      SLACK_API_URL,
      {
        channel: memberId,
        ...slackBody,
      },
      {
        headers: {
          Authorization: `Bearer ${SLACK_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );
    if (response.data.ok) {
      logger.info('Slack notification sent successfully.');
    } else {
      logger.error(`Error sending Slack notification: ${response.data.error}`);
    }
  } catch (error) {
    logger.error(`Error sending Slack notification: ${error.message}`);
  }
};

// Who reviews partner submissions comes from the roles collection now — the
// ids that used to be copied here had to stay in step with three other files
// by hand, and drifted silently the moment any role was recreated.
const roleAccess = require('../services/roleAccess.service');

// The only student fields a sub-agent may write, and only on a student they
// own. A whitelist rather than a blacklist so a future schema field is closed
// by default. Note what is ABSENT: `stage` (writing it would let an agent
// approve its own PendingReview submission), `createdBy` (ownership takeover),
// `assignedTo`, `denialReason`, `reviewedAt`, `qualified`, `channel`.
const SUB_AGENT_EDITABLE_STUDENT_FIELDS = [
  'firstName',
  'middleName',
  'lastName',
  'email',
  'phoneNo',
  'dob',
  'gender',
  'address',
  'city',
  'residence',
  'nationality',
  'passportNo',
  'passportStatus',
  'cgpa',
  'testTaken',
  'testScore',
  'preference',
  'emergencyContact',
  'previousSchool',
  'sourceOfFund',
  'parentsIncome',
  'countriesTraveled',
  // the portal's "Student photo" card
  'photo',
];

// Extra fields the SCHOOL COUNSELLOR intake collects. Kept separate from the
// list above so the sub-agent portal's accepted field set is byte-for-byte what
// it was — widening the shared list would have quietly granted sub-agents the
// ability to write passport detail they never previously could.
const SCHOOL_COUNSELOR_EXTRA_FIELDS = ['passportExpiry', 'passportIssueDate', 'civilNumber', 'placeOfIssue', 'placeOfBirth'];

/** The fields a given partner may set. Sub-agents get exactly the base list. */
const partnerEditableFields = (user) =>
  isSchoolCounselor(user)
    ? [...SUB_AGENT_EDITABLE_STUDENT_FIELDS, ...SCHOOL_COUNSELOR_EXTRA_FIELDS]
    : SUB_AGENT_EDITABLE_STUDENT_FIELDS;

// A student "belongs to" a user when that user created them or is assigned to
// them. Mirrors studentBelongsTo in application.controller.js.
const studentOwnedBy = (student, userId) => {
  if (!student || !userId) return false;
  if (student.createdBy && String(student.createdBy) === String(userId)) return true;
  return (student.assignedTo || []).some((a) => a && a.user && String(a.user) === String(userId));
};

const studentLabel = (s) => `${s.firstName || ''} ${s.lastName || ''}`.trim() || 'A student';

// Who referred this student, in words a reviewer reads. Derived from the
// student's acquisition channel rather than hardcoded: both sub-agents and
// partner schools land in the same review queue, and every notification used to
// say "a sub-agent" regardless of which one it actually was.
const partnerLabel = (student) => {
  switch (student && student.channel) {
    case 'counselor':
      return 'a school counsellor';
    case 'subagent':
      return 'a sub-agent';
    case 'lead':
      return 'an online lead';
    default:
      return 'a partner';
  }
};

// Notify every reviewer (admin/counselor) that an external partner -- a
// sub-agent OR a school counsellor -- submitted or resubmitted a student.
const notifyReviewersOfSubmission = async (io, student, resubmitted) => {
  const users = await userService.getUsers();
  const recipientIds = users.filter((u) => roleAccess.isReviewer(u)).map((u) => u._id.toString());
  if (!recipientIds.length) return;
  await notificationsService.createNotification(
    io,
    recipientIds,
    `${studentLabel(student)} was ${resubmitted ? 'resubmitted' : 'submitted'} for review by ${partnerLabel(student)}.`,
    'student',
    student.id,
    student.id,
    student.createdBy
  );
};

// Notify the partner who owns the student about an approve/deny decision.
// Works for either partner type; the wording avoids naming one.
const notifySubAgentOfDecision = async (io, student, approved) => {
  const recipientIds = new Set();
  if (student.createdBy) recipientIds.add(student.createdBy.toString());
  (student.assignedTo || []).forEach((a) => {
    if (a && a.user) recipientIds.add(a.user.toString());
  });
  if (!recipientIds.size) return;
  const message = approved
    ? `${studentLabel(student)} was approved and added to your students.`
    : `${studentLabel(student)} needs changes: ${student.denialReason || 'see the review notes'}.`;
  await notificationsService.createNotification(
    io,
    [...recipientIds],
    message,
    'student',
    student.id,
    student.id,
    student.createdBy
  );
};

const createStudent = catchAsync(async (req, res) => {
  const today = DateTime.now();
  const startOfToday = today.startOf('day');

  const todayFilter = {
    createdAt: {
      $gte: startOfToday.toJSDate(),
      $lt: today.endOf('day').toJSDate(),
    },
  };

  const studentCount = await Students.countDocuments(todayFilter);

  // `createdBy` is the ownership boundary the sub-agent portal is scoped by, so
  // it is set from the session and never accepted from the body. Previously the
  // field was not declared on the schema at all and was silently dropped, which
  // left `assignedTo` -- client-supplied and mutable -- as the only owner link.
  delete req.body.createdBy;

  // Same whitelist as updateStudent, so what a sub-agent cannot change later it
  // also cannot set at creation. `assignedTo` is the one that matters most: it
  // fans Slack DMs and in-app notifications out to any staff user named in the
  // body, and it feeds studentOwnedBy.
  if (isExternalPartner(req.user)) {
    const filtered = {};
    partnerEditableFields(req.user).forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) filtered[field] = req.body[field];
    });
    // A partner is never written into `assignedTo`, not even themselves.
    //
    // The assignment slots (Counsellor / Sales / Account Manager) describe who
    // on the INTERNAL team owns a piece of work; a school counsellor appearing
    // there reads as staffing and shows up in the staff Assign dialog. Their
    // link to the student is `createdBy`, which is set from the session below.
    // That is sufficient for both paths that matter: getStudents scopes a
    // partner to `$or: [createdBy, assignedTo.user]`, and studentOwnedBy checks
    // `createdBy` first — so dropping the self-assignment does not hide the
    // student from the portal that submitted it.
    filtered.assignedTo = [];
    req.body = filtered;
  }

  const body = {
    ...req.body,
    refrenceNo: `${today.toFormat('ddMMyy')}-000${studentCount + 1}`,
    // Submitter identity. Prefer the verified session; fall back to the actor
    // the client sent. These routes run behind softAuth, which lets an
    // unauthenticated request through rather than rejecting it, and access
    // tokens expire after 30 minutes — so `req.user` is routinely absent for a
    // partner who has had the portal open a while. Without the fallback those
    // students were created with no createdBy at all, which is the ownership
    // link their portal list AND the "who referred this student" line under the
    // channel chip both resolve through.
    createdBy: actorOf(req).id,
    // An EXTERNAL PARTNER's submission always lands in review, whatever the
    // body claims. This is what puts it in front of a counsellor: the review
    // queue selects on `stage: 'PendingReview'`, so a student created without
    // it is simply never seen by anyone. School counsellors were missing from
    // this branch, which is why their students vanished on creation.
    //
    // `source` and `channel` are forced rather than whitelisted: they are
    // reporting fields, not the partner's to choose.
    ...(isSubAgent(req.user) ? { stage: 'PendingReview', channel: 'subagent', source: 'ulearn' } : {}),
    ...(isSchoolCounselor(req.user) ? { stage: 'PendingReview', channel: 'counselor', source: 'ulearn' } : {}),
  };
  const student = await studentsService.createStudent(body);

  // Sub-agent submissions land in PendingReview — alert all reviewers in realtime.
  if (student.stage === 'PendingReview') {
    try {
      await notifyReviewersOfSubmission(req.app.get('io'), student, false);
    } catch (err) {
      logger.error(`Review-submission notification failed: ${err.message}`);
    }
  }

  const users = await userService.getUsers();
  const { assignedTo } = student;

  const updatedUsers = users
    .filter((user) => assignedTo.some((assignment) => assignment.user.equals(user._id)))
    .flatMap((user) => {
      const assignedRoles = assignedTo
        .filter((assignment) => assignment.user.equals(user._id))
        .map((assignment) => assignment.role);

      return assignedRoles.map((role) => ({
        ...user._doc,
        assignedAs: role,
      }));
    });

  const usersWithRoles = updatedUsers;

  const simplifiedUsers = usersWithRoles.map((user) => {
    return {
      _id: user._id,
      name: user.name,
      email: user.email,
      slackMemberId: user.slackMemberId,
      avatar: user.avatar,
      assignedAs: user.assignedAs,
    };
  });

  await Promise.all(
    simplifiedUsers.map(async (user) => {
      sendSlackNotification(user.slackMemberId, {
        attachments: [
          {
            pretext: `*You have been assigned as ${user.assignedAs} for ${student.firstName || ''} ${
              student.middleName || ''
            } ${student.lastName || ''}*`,
            text: `\nRef. No - ${student.refrenceNo}.\nPhone No - ${student.phoneNo}.\nEmail - ${student.email}.`,
          },
        ],
      });
      const io = req.app.get('io');

      await notificationsService.createNotification(
        io,
        [user._id.toString()],
        `You have been assigned as ${user.assignedAs} for ${student.firstName || ''} ${student.middleName || ''} ${
          student.lastName || ''
        }`,
        'student',
        student.id,
        student.id,
        req.body.createdBy
      );
    })
  );
  res.status(httpStatus.CREATED).send(student);
});

/**
 * POST /students/:studentId/new-journey
 *
 * A student comes back for another degree: enrolled in a Bachelor's and now
 * wants a Master's, finished a Master's and wants a second one, or was Lost
 * last cycle and is re-engaging. One student record, many journeys -- creating
 * a duplicate student would split their documents, history and identity.
 *
 * The current cycle is snapshotted into `journeys[]`, then the live fields
 * reset for the new one. Only a CLOSED journey can be succeeded: while one is
 * open (PendingReview/NotApplied/Applied) the right verb is editing it, not
 * stacking a second journey on top.
 *
 * Stage after reset depends on who is asking. A partner's new journey is a new
 * REFERRAL -- it goes back through PendingReview and the reviewers are
 * notified, exactly like a first submission. Staff starting one puts the
 * student straight into NotApplied.
 */
const JOURNEY_CLOSED_STAGES = ['Enrolled', 'Lost', 'Denied'];
const NEW_JOURNEY_PREF_FIELDS = [
  'studyDestinations',
  'destinations',
  'courseLevel',
  'courseSubjectIds',
  'universities',
  'intakeMonth',
  'intakeYear',
];

const startNewJourney = catchAsync(async (req, res) => {
  const student = await studentsService.getStudentById(req.params.studentId);
  if (!student) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Students not found');
  }

  const partner = isExternalPartner(req.user);
  if (partner && !studentOwnedBy(student, req.user.id)) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Students not found');
  }
  // With APPLICATION_AUTH off an unauthenticated caller reaches here; treat it
  // like staff for stage purposes but never for ownership bypass -- there is no
  // ownership to check without an identity, matching the rest of this file.

  if (!JOURNEY_CLOSED_STAGES.includes(student.stage)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `A new journey can only start once the current one is closed. This student is at "${student.stage}" -- edit the current journey instead.`
    );
  }

  const pref = student.preference || {};
  const previous = (student.journeys || [])[(student.journeys || []).length - 1];

  // The degree is stored on the preference as a CourseLevels id, so the label
  // has to be resolved here — snapshotting the raw id left every closed
  // journey's degree blank in the UI.
  let degreeLabel;
  const rawLevel = pref.courseLevel;
  if (typeof rawLevel === 'string' && /^[0-9a-f]{24}$/i.test(rawLevel)) {
    try {
      // eslint-disable-next-line global-require
      const { CourseLevels } = require('../models');
      const lvl = await CourseLevels.findById(rawLevel).select('en_name');
      degreeLabel = lvl && lvl.en_name;
    } catch (err) {
      degreeLabel = undefined;
    }
  } else if (typeof rawLevel === 'string') {
    degreeLabel = rawLevel;
  }

  // courseSubjectIds holds { slug?, name } objects; String()-ing the first one
  // produced "[object Object]".
  const majorLabel = Array.isArray(pref.courseSubjectIds)
    ? pref.courseSubjectIds
        .map((x) => (x && typeof x === 'object' ? x.name : x))
        .filter(Boolean)
        .join(', ') || undefined
    : undefined;

  // The application this journey ended in (a place), if any: one of this
  // cycle's applications whose current phase is Done. Read so the closed
  // journey keeps where the student studied, and the next one can say what it
  // progressed from.
  let enrolledApp = null;
  try {
    const earlier = new Set((student.journeys || []).flatMap((j) => (j.applications || []).map((x) => String(x))));
    const ids = (student.applications || []).map((x) => String(x)).filter((x) => /^[0-9a-f]{24}$/i.test(x));
    const cycleApps = ids.length
      ? await Application.find({ _id: { $in: ids } }).lean()
      : (await Application.find({ studentId: student._id }).lean()).filter((a) => !earlier.has(String(a._id)));
    const phaseOf = (a) => {
      const ph = (a.portalApplicationStatus && a.portalApplicationStatus.applicationPhases) || [];
      const cur = ph.find((x) => x && x.phaseState === 'AwaitingResponseStudent') || ph.find((x) => x && x.isCurrent);
      return cur ? cur.status : null;
    };
    enrolledApp = cycleApps.find((a) => !a.rejected && phaseOf(a) === 'Done') || null;
  } catch (err) {
    enrolledApp = null;
  }
  const enrolledUniversity = enrolledApp && enrolledApp.institute ? enrolledApp.institute.name : undefined;
  const enrolledCourse = enrolledApp ? enrolledApp.courseName : undefined;

  student.journeys = [
    ...(student.journeys || []),
    {
      // A second journey did not start when the STUDENT was created — it
      // started when the one before it closed.
      startedAt: (previous && previous.closedAt) || student.createdAt,
      // reviewedAt is the moment a referral was decided, which is the closing
      // moment only for a denial; anything else closes now.
      closedAt: student.stage === 'Denied' && student.reviewedAt ? student.reviewedAt : new Date(),
      degree: degreeLabel,
      major: majorLabel,
      destination: pref.studyDestinations,
      intakeMonth: pref.intakeMonth,
      intakeYear: pref.intakeYear,
      outcome: student.stage,
      applications: student.applications || [],
      openedBy: req.user ? req.user.id : undefined,
      provider: pref.provider || undefined,
      enrolledApplication: enrolledApp ? enrolledApp._id : undefined,
      enrolledUniversity,
      enrolledCourse,
    },
  ];

  // A journey that ended in a place (a Foundation year, say) is what the new
  // one progresses from; anything else leaves nothing to progress from.
  student.progressedFrom =
    student.stage === 'Enrolled'
      ? {
          journeyIndex: student.journeys.length - 1,
          degree: degreeLabel,
          provider: pref.provider || undefined,
          university: enrolledUniversity,
          course: enrolledCourse,
          closedAt: new Date(),
        }
      : undefined;

  // Reset the live cycle. New preference comes from the body, whitelisted.
  const nextPref = {};
  NEW_JOURNEY_PREF_FIELDS.forEach((f) => {
    if (req.body.preference && Object.prototype.hasOwnProperty.call(req.body.preference, f)) {
      nextPref[f] = req.body.preference[f];
    }
  });
  student.preference = nextPref;
  student.applications = [];
  student.denialReason = undefined;
  // Release the place held by the journey just closed. onHold is set when an
  // application reaches Confirmation and is read by the application screens as
  // "this student has committed somewhere" — carried into a new cycle it
  // freezes every application in it, with nothing left to release it.
  student.onHold = false;
  student.stage = partner ? 'PendingReview' : 'NotApplied';
  await student.save();

  if (partner) {
    try {
      await notifyReviewersOfSubmission(req.app.get('io'), student, true);
    } catch (err) {
      logger.error(`New-journey notification failed: ${err.message}`);
    }
  }

  res.send(student);
});

const getStudents = catchAsync(async (req, res) => {
  // A sub-agent sees only students it created. This replaces the CRM-side
  // filtering in useAgentStudents.ts, which fetched every sub-agent's students
  // (they all shared one role id) and narrowed the array in the browser -- the
  // other agents' records were on the wire either way.
  if (isExternalPartner(req.user)) {
    // Same predicate as studentOwnedBy (created-by OR assigned-to), so a student
    // is not readable at /students/:id while being invisible in the list.
    const own = await studentsService.queryStudents(
      { $or: [{ createdBy: req.user.id }, { 'assignedTo.user': req.user.id }] },
      {
        sortBy: req.query.sortBy || 'createdAt:desc',
        limit: Number(req.query.limit) || 200,
        page: Number(req.query.page) || 1,
      }
    );
    return res.send(own);
  }

  const filter = pick(req.query, [
    'name',
    'role',
    'qualified',
    'degree',
    'nationality',
    'residence',
    'status',
    'stage',
    'previousSchool',
  ]);

  if (req.query.ambassadorName) {
    filter.ambassadorName = req.query.ambassadorName;
  }

  // ---- Back-office list facets (the redesigned Students page's Filters
  // drawer). Every one of these is optional and multi-valued ("a,b,c"), and a
  // single value behaves exactly as before, so older clients are unaffected.
  const csv = (v) =>
    String(v == null ? '' : v)
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
  const inOrEq = (values) => (values.length === 1 ? values[0] : { $in: values });

  // `degree` was picked raw but students have no `degree` field: it is the
  // course-level id stored at preference.courseLevel.
  if (filter.degree !== undefined) {
    const levels = csv(filter.degree);
    delete filter.degree;
    if (levels.length) filter['preference.courseLevel'] = inOrEq(levels);
  }
  // `nationality` is an object on the document; match on its English name.
  if (filter.nationality !== undefined) {
    const names = csv(filter.nationality);
    delete filter.nationality;
    if (names.length) filter['nationality.english_name'] = inOrEq(names);
  }
  if (typeof filter.stage === 'string' && filter.stage.includes(',')) {
    filter.stage = { $in: csv(filter.stage) };
  }
  if (typeof filter.status === 'string' && filter.status.includes(',')) {
    filter.status = { $in: csv(filter.status) };
  }
  if (req.query.channel) {
    const channels = csv(req.query.channel);
    if (channels.length) filter.channel = inOrEq(channels);
  }
  // intake="September 2026,January 2027" → preference.intakeMonth/intakeYear pairs.
  if (req.query.intake) {
    const pairs = csv(req.query.intake)
      .map((label) => {
        const m = label.match(/^(\S+)\s+(\d{4})$/);
        return m ? { 'preference.intakeMonth': m[1], 'preference.intakeYear': m[2] } : null;
      })
      .filter(Boolean);
    if (pairs.length) {
      filter.$and = [...(filter.$and || []), { $or: pairs }];
    }
  }
  // ---- Profile-label facets (the drawer's "Profile labels" / "What they
  // study" sections). All comma lists; absent = no constraint.
  if (req.query.funding) {
    const SELF = ['Personal Savings', 'Help From Family'];
    const picks = csv(req.query.funding);
    const wantSelf = picks.includes('Self Funded');
    const wantSponsored = picks.includes('Sponsored');
    if (wantSelf && !wantSponsored) filter.sourceOfFund = { $in: SELF };
    else if (wantSponsored && !wantSelf) filter.sourceOfFund = { $nin: [...SELF, null, ''] };
  }
  if (req.query.school) {
    const schools = csv(req.query.school);
    if (schools.length) filter.previousSchool = inOrEq(schools);
  }
  if (req.query.provider) {
    const providers = csv(req.query.provider);
    if (providers.length) filter['preference.provider'] = inOrEq(providers);
  }
  if (req.query.labels) {
    const labels = csv(req.query.labels);
    if (labels.length) filter.labels = { $in: labels };
  }
  if (req.query.major) {
    // courseSubjectIds holds bare strings in older records and { name, slug }
    // objects in newer ones — match either shape.
    const majors = csv(req.query.major);
    if (majors.length) {
      filter.$and = [
        ...(filter.$and || []),
        {
          $or: [{ 'preference.courseSubjectIds': { $in: majors } }, { 'preference.courseSubjectIds.name': { $in: majors } }],
        },
      ];
    }
  }
  // appStage / university: constraints on the student's applications. Resolve
  // the matching application ids first; students.applications stores ids as
  // strings in some records and ObjectIds in others, so both forms are matched.
  const appQuery = {};
  if (req.query.appStage) {
    const stages = csv(req.query.appStage);
    if (stages.length) {
      appQuery['portalApplicationStatus.applicationPhases'] = { $elemMatch: { isCurrent: true, status: { $in: stages } } };
    }
  }
  if (req.query.university) {
    const unis = csv(req.query.university);
    if (unis.length) appQuery['institute.name'] = { $in: unis };
  }
  if (Object.keys(appQuery).length) {
    const ids = await Application.find(appQuery).distinct('_id');
    const both = [...ids, ...ids.map((x) => String(x))];
    filter.applications = { $in: both };
  }

  // assignedSlots='[{"user":"<id>","role":"sales"}]' → the student must have
  // that user in that slot. `role` is the free-text slot name on assignedTo
  // ("sales" / "account manager" / "operations"), matched case-insensitively.
  if (req.query.assignedSlots) {
    try {
      const slots = JSON.parse(req.query.assignedSlots);
      if (!Array.isArray(slots)) throw new Error('assignedSlots must be an array');
      const conds = slots
        .filter((sl) => sl && sl.user)
        .map((sl) => {
          const cond = { user: mongoose.Types.ObjectId(sl.user) };
          if (sl.role) cond.role = { $regex: `^${String(sl.role).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' };
          return { assignedTo: { $elemMatch: cond } };
        });
      if (conds.length) filter.$and = [...(filter.$and || []), ...conds];
    } catch (error) {
      return res.status(400).send({ message: 'Invalid assignedSlots format. Expected JSON array of {user, role}.' });
    }
  }

  // Handle assigned user filters
  if (req.query.assignedUserId) {
    try {
      const assignedUserId = mongoose.Types.ObjectId(req.query.assignedUserId);
      filter['assignedTo.user'] = assignedUserId;
    } catch (error) {
      return res.status(400).send({ message: 'Invalid assignedUserId format.' });
    }
  }

  // NEW: Filter by assigned userRole (ID field)
  if (req.query.assignedUserRoleId) {
    try {
      // Check if userRole ID is provided
      if (!req.query.assignedUserRoleId) {
        return res.status(400).send({ message: 'assignedUserRoleId is required.' });
      }

      // Parse the userRole parameter (can be a single ID or comma-separated list of IDs)
      const userRoleIds = req.query.assignedUserRoleId.split(',').map((id) => id.trim());

      // Convert string IDs to ObjectId if they're valid MongoDB ObjectIds
      const objectIdUserRoleIds = userRoleIds.map((id) => {
        try {
          return mongoose.Types.ObjectId(id);
        } catch (error) {
          // If it's not a valid ObjectId, keep it as string
          return id;
        }
      });

      // Filter by userRole field in the assignedTo array
      filter['assignedTo.userRole'] = { $in: objectIdUserRoleIds };
    } catch (error) {
      return res.status(400).send({ message: 'Invalid assignedUserRoleId format.' });
    }
  }

  // NEW: Filter by both userId and userRole together
  if (req.query.assignedUserId && req.query.assignedUserRoleId) {
    try {
      const assignedUserId = mongoose.Types.ObjectId(req.query.assignedUserId);

      // Parse userRole IDs
      const userRoleIds = req.query.assignedUserRoleId.split(',').map((id) => id.trim());
      const objectIdUserRoleIds = userRoleIds.map((id) => {
        try {
          return mongoose.Types.ObjectId(id);
        } catch (error) {
          return id;
        }
      });

      // Use $elemMatch to find array elements that match both conditions
      filter.assignedTo = {
        $elemMatch: {
          user: assignedUserId,
          userRole: { $in: objectIdUserRoleIds },
        },
      };

      // Remove the individual filters to avoid conflicts
      delete filter['assignedTo.user'];
      delete filter['assignedTo.userRole'];
    } catch (error) {
      return res.status(400).send({ message: 'Invalid userId or userRoleId format.' });
    }
  }

  // NEW: Advanced filtering with multiple user-role combinations
  if (req.query.assignedUsersWithRoles) {
    try {
      // Expected format: [{user: "userId", userRole: "roleId"}, ...] as JSON string
      const assignedUsersFilter = JSON.parse(req.query.assignedUsersWithRoles);

      if (Array.isArray(assignedUsersFilter) && assignedUsersFilter.length > 0) {
        // Create an array of $elemMatch conditions for each user-userRole pair
        const elemMatchConditions = assignedUsersFilter.map((item) => {
          if (!item.user || !item.userRole) {
            throw new Error('Each assigned user must have both user and userRole properties');
          }

          const condition = {};

          if (item.user) {
            condition.user = mongoose.Types.ObjectId(item.user);
          }

          if (item.userRole) {
            const userRoleIds = Array.isArray(item.userRole) ? item.userRole : [item.userRole];

            condition.userRole = {
              $in: userRoleIds.map((id) => {
                try {
                  return mongoose.Types.ObjectId(id);
                } catch (error) {
                  return id;
                }
              }),
            };
          }

          return { $elemMatch: condition };
        });

        // Combine conditions with $and to match all specified user-userRole pairs
        if (elemMatchConditions.length === 1) {
          [filter.assignedTo] = elemMatchConditions;
        } else {
          filter.$and = [...(filter.$and || []), ...elemMatchConditions.map((condition) => ({ assignedTo: condition }))];
        }
      }
    } catch (error) {
      return res.status(400).send({
        message: 'Invalid assignedUsersWithRoles format. Expected JSON array with user and userRole properties.',
        error: error.message,
      });
    }
  }

  // Every member of staff lists every student, as admins do. Partners
  // (sub-agents, school counsellors) are scoped above to their own.

  // countsByStage=PendingReview,NotApplied,… → { counts: { <stage>: n } } for the
  // list's status tabs with every other filter applied: one round trip instead
  // of one 1-row page per tab. Counted with countDocuments (schema casting, same
  // as the list) in parallel on the server.
  if (req.query.countsByStage) {
    const stageList = csv(req.query.countsByStage).slice(0, 12);
    const base = { ...filter };
    delete base.stage;
    const ns = await Promise.all(stageList.map((st) => Students.countDocuments({ ...base, stage: st })));
    const counts = {};
    stageList.forEach((st, i) => {
      counts[st] = ns[i];
    });
    return res.send({ counts });
  }

  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await studentsService.queryStudents(filter, options);
  res.send(result);
});

/**
 * Distinct values the Students page's Filters drawer offers — schools,
 * providers, labels, majors, nationalities, intakes and the universities
 * students have applied to. Small, uncached, one round-trip per page load.
 */
const getStudentFacets = catchAsync(async (req, res) => {
  const clean = (arr) => arr.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim());
  const uniq = (arr) => Array.from(new Set(arr)).sort((a, b) => a.localeCompare(b));
  const [schools, providers, labels, subjectNames, subjectStrings, nationalities, months, years, universities] =
    await Promise.all([
      Students.distinct('previousSchool'),
      Students.distinct('preference.provider'),
      Students.distinct('labels'),
      Students.distinct('preference.courseSubjectIds.name'),
      Students.distinct('preference.courseSubjectIds'),
      Students.distinct('nationality.english_name'),
      Students.distinct('preference.intakeMonth'),
      Students.distinct('preference.intakeYear'),
      Application.distinct('institute.name'),
    ]);
  const MO = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  const intakes = [];
  clean(years.map(String)).forEach((y) => clean(months).forEach((m) => intakes.push(`${m} ${y}`)));
  intakes.sort((a, b) => {
    const [ma, ya] = a.split(' ');
    const [mb, yb] = b.split(' ');
    return Number(ya) - Number(yb) || MO.indexOf(ma) - MO.indexOf(mb);
  });
  res.send({
    schools: uniq(clean(schools)),
    providers: uniq(clean(providers)),
    labels: uniq(clean(labels)),
    majors: uniq(clean([...subjectNames, ...subjectStrings.filter((x) => typeof x === 'string')])),
    nationalities: uniq(clean(nationalities)),
    intakes,
    universities: uniq(clean(universities)),
  });
});

/**
 * How many students each staff member is on (any slot), as { <userId>: n } —
 * the Settings › Users list showed this with one request per user.
 */
const getStudentCountsByUser = catchAsync(async (req, res) => {
  const rows = await Students.aggregate([
    { $match: { 'assignedTo.0': { $exists: true } } },
    { $project: { u: { $setUnion: [{ $ifNull: ['$assignedTo.user', []] }, []] } } },
    { $unwind: '$u' },
    { $group: { _id: '$u', n: { $sum: 1 } } },
  ]);
  const counts = {};
  rows.forEach((r) => {
    if (r._id) counts[String(r._id)] = r.n;
  });
  res.send({ counts });
});

const getStudent = catchAsync(async (req, res) => {
  const student = await studentsService.getStudentById(req.params.studentId);
  if (!student) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Student not found');
  }
  // A sub-agent may read only its own students. 404 rather than 403 so walking
  // ids reveals nothing about which students exist.
  if (isExternalPartner(req.user) && !studentOwnedBy(student, req.user.id)) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Student not found');
  }
  res.send(student);
});

// Read-only share: make a student visible to a school counselor and notify them.
// Does NOT assign the student (no assignedTo change) — the counselor gets a
// notification linking to a read-only view.
const shareStudentWithCounselor = catchAsync(async (req, res) => {
  const { userId, sharedBy } = req.body;
  if (!userId) {
    return res.status(400).send({ message: 'userId (school counselor) is required.' });
  }
  const student = await studentsService.getStudentById(req.params.studentId);
  if (!student) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Student not found');
  }

  const alreadyShared = (student.sharedWithCounselors || []).some((s) => s.user && s.user.toString() === userId);
  if (!alreadyShared) {
    await Students.updateOne(
      { _id: req.params.studentId },
      { $push: { sharedWithCounselors: { user: userId, sharedBy, sharedAt: new Date() } } }
    );
  }

  const name = `${student.firstName || ''} ${student.lastName || ''}`.trim() || 'a student';
  await notificationsService.createNotification(
    req.app.get('io'),
    [userId],
    `${name} has been shared with you`,
    'student',
    student.id,
    student.id,
    sharedBy
  );

  res.status(httpStatus.OK).send({ message: 'Student shared with counselor', alreadyShared });
});

/**
 * POST /students/:studentId/partner-resubmit — a partner sends back a student
 * Ulearn returned to them ("Action needed"): Denied → PendingReview, and every
 * reviewer gets the usual in-app "resubmitted for review" notice (no Slack).
 *
 * Its own route because a partner's PATCH cannot write `stage` (see
 * SUB_AGENT_EDITABLE_STUDENT_FIELDS) — the portal's "Resubmit to Ulearn" used
 * to PATCH a stage that was silently dropped. Only the owner, only from Denied.
 */
const partnerResubmit = catchAsync(async (req, res) => {
  if (!isExternalPartner(req.user)) throw new ApiError(httpStatus.FORBIDDEN, 'Only partners resubmit their own students.');
  const existing = await studentsService.getStudentById(req.params.studentId);
  if (!existing || !studentOwnedBy(existing, req.user.id)) throw new ApiError(httpStatus.NOT_FOUND, 'Student not found');
  if (existing.stage !== 'Denied') {
    throw new ApiError(httpStatus.CONFLICT, 'Only a student Ulearn sent back to you can be resubmitted.');
  }
  const editor = actorOf(req);
  const student = await studentsService.updateStudentById(req.params.studentId, {
    stage: 'PendingReview',
    denialReason: '',
    editor: req.body && req.body.editor,
  });
  try {
    await activitiesService.logActivity({
      student: student.id,
      type: 'stage',
      text: `${editor.name} resubmitted the referral for review`,
      actorId: editor.id,
      actorName: editor.name,
      meta: { stage: 'PendingReview' },
    });
    await notifyReviewersOfSubmission(req.app.get('io'), student, true);
  } catch (err) {
    logger.error(`Resubmit notification failed: ${err.message}`);
  }
  res.send(student);
});

/**
 * POST /students/:studentId/partner-withdraw { reason? } — a partner removes
 * their own student before Ulearn has taken it on (PendingReview or Denied):
 * the record moves to Lost with the reason, which the portal shows in its red
 * "Denied" bucket ("Removed by sub agent"). Once Ulearn has accepted a student
 * it is in the staff pipeline, so the partner is asked to contact Ulearn.
 */
const partnerWithdraw = catchAsync(async (req, res) => {
  if (!isExternalPartner(req.user)) throw new ApiError(httpStatus.FORBIDDEN, 'Only partners remove their own students.');
  const existing = await studentsService.getStudentById(req.params.studentId);
  if (!existing || !studentOwnedBy(existing, req.user.id)) throw new ApiError(httpStatus.NOT_FOUND, 'Student not found');
  if (!['PendingReview', 'Denied'].includes(existing.stage)) {
    throw new ApiError(
      httpStatus.CONFLICT,
      'Ulearn is already working with this student — contact your Ulearn counselor to remove them.'
    );
  }
  const given = String((req.body && req.body.reason) || '')
    .trim()
    .slice(0, 500);
  const reason = given || 'Student removed by the sub agent.';
  const editor = actorOf(req);
  const student = await studentsService.updateStudentById(req.params.studentId, {
    stage: 'Lost',
    denialReason: reason,
    lostReason: 'Removed by partner',
    reviewedAt: new Date(),
    editor: req.body && req.body.editor,
  });
  try {
    await activitiesService.logActivity({
      student: student.id,
      type: 'stage',
      text: `${editor.name} removed this student`,
      actorId: editor.id,
      actorName: editor.name,
      meta: { stage: 'Lost', reason },
    });
  } catch (err) {
    logger.error(`Withdraw activity failed: ${err.message}`);
  }
  res.send(student);
});

/**
 * "My students" scope for a search, from the same params GET /students takes:
 * assignedUserId (any slot) and assignedSlots ([{user, role}]). Returns a Mongo
 * condition, {} for none; throws 400 on a malformed value.
 */
const searchScopeOf = (query) => {
  const conds = [];
  if (query.assignedUserId) {
    try {
      conds.push({ 'assignedTo.user': mongoose.Types.ObjectId(query.assignedUserId) });
    } catch (e) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid assignedUserId format.');
    }
  }
  if (query.assignedSlots) {
    let slots;
    try {
      slots = JSON.parse(query.assignedSlots);
      if (!Array.isArray(slots)) throw new Error('not an array');
      slots
        .filter((sl) => sl && sl.user)
        .forEach((sl) => {
          const cond = { user: mongoose.Types.ObjectId(sl.user) };
          if (sl.role) cond.role = { $regex: `^${String(sl.role).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' };
          conds.push({ assignedTo: { $elemMatch: cond } });
        });
    } catch (e) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid assignedSlots format. Expected JSON array of {user, role}.');
    }
  }
  return conds.length ? { $and: conds } : {};
};

const updateStudent = catchAsync(async (req, res) => {
  const existingStudent = await studentsService.getStudentById(req.params.studentId);

  if (!existingStudent) {
    return res.status(404).send({ message: 'Student not found' });
  }

  // A sub-agent may edit only its own students, and only the profile fields
  // above. updateStudentById does Object.assign(student, body).save(), so an
  // unfiltered body here would let an agent set `stage: 'NotApplied'` (self-
  // approving its own submission) or `createdBy` (taking over another agent's
  // student and, through that, the ability to submit applications for them).
  if (isExternalPartner(req.user)) {
    if (!studentOwnedBy(existingStudent, req.user.id)) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Student not found');
    }
    const filtered = {};
    partnerEditableFields(req.user).forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) filtered[field] = req.body[field];
    });
    // `editor` is metadata the activity log reads, not a stored field.
    if (req.body.editor) filtered.editor = req.body.editor;
    req.body = filtered;

    // Adding a student refuses an email another student already has. Editing
    // did not, so the same address could be saved onto a second record.
    if (typeof filtered.email === 'string' && filtered.email.trim()) {
      const email = filtered.email.trim().toLowerCase();
      const current = String(existingStudent.email || '').toLowerCase();
      if (email !== current && (await Students.isEmailTaken(email, existingStudent._id))) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'A student with this email address already exists');
      }
    }
  }

  const student = await studentsService.updateStudentById(req.params.studentId, req.body);

  // Timeline: record a profile edit (non-fatal). Assignment changes get their
  // own 'assignment' event below, and stage transitions are covered elsewhere,
  // so exclude those keys from what counts as a plain profile edit.
  const editor = actorOf(req);
  const NON_PROFILE_KEYS = new Set(['editor', 'assignedTo', 'stage']);
  const editedFields = Object.keys(req.body).filter((k) => !NON_PROFILE_KEYS.has(k));
  if (editedFields.length > 0) {
    await activitiesService.logActivity({
      student: student.id,
      type: 'edit',
      text: `${editor.name} updated the profile`,
      actorId: editor.id,
      actorName: editor.name,
      meta: { fields: editedFields },
    });
  }

  const io = req.app.get('io');

  // Sub-agent review workflow: emit realtime notifications on stage transitions.
  // PendingReview -> notify reviewers (new submission or resubmission after a
  // denial). Denied / approved (-> NotApplied) -> notify the owning sub-agent.
  const prevStage = existingStudent.stage;
  const nextStage = student.stage;
  if (req.body.stage && nextStage !== prevStage) {
    try {
      if (nextStage === 'PendingReview') {
        await notifyReviewersOfSubmission(io, student, prevStage === 'Denied');
      } else if (nextStage === 'Denied') {
        await notifySubAgentOfDecision(io, student, false);
        await activitiesService.logActivity({
          student: student.id,
          type: 'stage',
          text: `${editor.name} did not approve this referral${student.denialReason ? `: ${student.denialReason}` : ''}`,
          actorId: editor.id,
          actorName: editor.name,
          meta: { stage: 'Denied' },
        });
      } else if (nextStage === 'NotApplied' && (prevStage === 'PendingReview' || prevStage === 'Denied')) {
        await notifySubAgentOfDecision(io, student, true);
        // Timeline: the approval the portal's Recent updates should show.
        await activitiesService.logActivity({
          student: student.id,
          type: 'stage',
          text: `${editor.name} approved the referral — applications are now open`,
          actorId: editor.id,
          actorName: editor.name,
          meta: { stage: 'NotApplied' },
        });
      }
    } catch (err) {
      logger.error(`Review-transition notification failed: ${err.message}`);
    }
  }

  const { assignedTo: previousAssignedTo } = existingStudent;
  const { assignedTo: updatedAssignedTo } = student;

  const newAssignments = updatedAssignedTo.filter(
    (updatedAssignment) =>
      !previousAssignedTo.some(
        (prevAssignment) =>
          prevAssignment.user.toString() === updatedAssignment.user.toString() &&
          prevAssignment.role === updatedAssignment.role
      )
  );

  if (newAssignments.length === 0) {
    return res.send(student);
  }

  const users = await userService.getUsers();

  const newAssignedUsers = users
    .filter((user) => newAssignments.some((assignment) => assignment.user.equals(user._id)))
    .flatMap((user) => {
      const assignedRoles = newAssignments
        .filter((assignment) => assignment.user.equals(user._id))
        .map((assignment) => assignment.role);

      return assignedRoles.map((role) => ({
        ...user._doc,
        assignedAs: role,
      }));
    });

  const simplifiedUsers = newAssignedUsers.map((user) => ({
    _id: user._id,
    name: user.name,
    email: user.email,
    slackMemberId: user.slackMemberId,
    avatar: user.avatar,
    assignedAs: user.assignedAs,
  }));
  await Promise.all(
    simplifiedUsers.map(async (user) => {
      sendSlackNotification(user.slackMemberId, {
        attachments: [
          {
            color: '#fd3e60',
            pretext: `*You have been assigned as ${user.assignedAs} for ${student.firstName || ''} ${
              student.middleName || ''
            } ${student.lastName || ''}*`,
            text: `\nRef. No - ${student.refrenceNo}.\nPhone No - ${student.phoneNo}.\nEmail - ${student.email}.`,
          },
        ],
      });
      await notificationsService.createNotification(
        io,
        [user._id.toString()],
        `You have been assigned as ${user.assignedAs} for ${student.firstName || ''} ${student.middleName || ''} ${
          student.lastName || ''
        }`,
        'student',
        student.id,
        student.id,
        student.createdBy
      );
    })
  );

  // Timeline: record the assignment change (non-fatal).
  await activitiesService.logActivity({
    student: student.id,
    type: 'assignment',
    text: `${editor.name} updated assignments: ${simplifiedUsers.map((u) => `${u.name} (${u.assignedAs})`).join(', ')}`,
    actorId: editor.id,
    actorName: editor.name,
    meta: { assignments: simplifiedUsers.map((u) => ({ user: u._id, role: u.assignedAs })) },
  });

  res.send(student);
});

const deleteStudent = catchAsync(async (req, res) => {
  await studentsService.deleteStudentById(req.params.studentId);
  res.status(httpStatus.NO_CONTENT).send();
});

const getStudentsByMonths = catchAsync(async (req, res) => {
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'populate']);

  const startDate = DateTime.fromISO(new Date(req.query.startDate).toISOString(), {
    zone: 'Asia/Riyadh',
  }).startOf('day');
  const endDate = DateTime.fromISO(new Date(req.query.endDate).toISOString(), {
    zone: 'Asia/Riyadh',
  }).endOf('day');

  const sd = convertASTToUTC(startDate, true).toString();
  const ed = convertASTToUTC(endDate, true).toString();

  const result = await studentsService.queryStudents(
    {
      $and: [
        {
          createdAt: {
            $gte: sd,
            $lte: ed,
          },
        },
        { qualified: req.query.qualified },
      ],
    },
    options
  );
  res.send(result);
});

const searchStudents = catchAsync(async (req, res) => {
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'populate', 'stage']);
  const results = await studentsService.searchStudent(req.params.text, options, searchScopeOf(req.query));
  res.status(200).send(results);
});

const getTopStudentsByNationality = catchAsync(async (req, res) => {
  try {
    const topNationalities = await studentsService.getTopNationalities({
      ...req.query,
    });
    res.send(topNationalities);
  } catch (error) {
    res.status(httpStatus.INTERNAL_SERVER_ERROR).send(error.message);
  }
});

const getStudentCountByAssignedRole = async (req, res) => {
  try {
    const data = await studentsService.getCountByAssignedRole({
      ...req.query,
    });
    res.status(200).send(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getDashboardStudentData = catchAsync(async (req, res) => {
  const filterOptions = {
    filter: pick(req.query, ['name', 'role', 'qualified', 'degree', 'nationality', 'residence', 'status', 'stage']),
    options: pick(req.query, ['sortBy', 'limit', 'page']),
  };

  const startDate = DateTime.fromISO(new Date(req.query.startDate).toISOString(), {
    zone: 'Asia/Riyadh',
  }).startOf('day');
  const endDate = DateTime.fromISO(new Date(req.query.endDate).toISOString(), {
    zone: 'Asia/Riyadh',
  }).endOf('day');

  // The Kuwait days as real instants. They were sent on as wall time read as
  // UTC — three hours late at both ends — while every other dashboard card
  // took the range as instants, so "Students applied by nationality" counted a
  // different window from the cards beside it (82 against 55 from a browser
  // outside Kuwait).
  const sd = convertASTToUTC(startDate).toString();
  const ed = convertASTToUTC(endDate).toString();

  const dashboardData = await studentsService.getDashboardData({
    startDate: sd,
    endDate: ed,
    filterOptions,
  });
  res.send(dashboardData);
});

// Per-counselor funnel leaderboard (Applied / Offers / Enrolled) for the
// counselor "My Desk" Season board. Optional startDate/endDate scope it.
const getCounselorLeaderboard = catchAsync(async (req, res) => {
  const { startDate, endDate } = req.query;
  const leaderboard = await studentsService.getCounselorLeaderboard({
    startDate: startDate || undefined,
    endDate: endDate || undefined,
  });
  res.send(leaderboard);
});

module.exports = {
  partnerResubmit,
  partnerWithdraw,
  getStudentFacets,
  getStudentCountsByUser,
  createStudent,
  startNewJourney,
  getStudents,
  getStudent,
  shareStudentWithCounselor,
  updateStudent,
  deleteStudent,
  getTopStudentsByNationality,
  searchStudents,
  getStudentsByMonths,
  getStudentCountByAssignedRole,
  getDashboardStudentData,
  getCounselorLeaderboard,
};
