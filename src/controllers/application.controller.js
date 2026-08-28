/* eslint-disable no-plusplus */
/* eslint-disable no-return-assign */
/* eslint-disable eqeqeq */
/* eslint-disable array-callback-return */
const httpStatus = require('http-status');
const axios = require('axios');

const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');

const { applicationService, studentsService, userService, notificationsService, activitiesService } = require('../services');
const { Application } = require('../models');
const { isSubAgent, isSchoolCounselor, isExternalPartner, roleIdOf } = require('../middlewares/subAgentScope');
const { actorOf } = require('../utils/actor');
const roleAccess = require('../services/roleAccess.service');
const mongoose = require('mongoose');

// The pipeline stores raw enum strings; the UI relabels "Done" as "Enrolled".
const phaseLabel = (status) => (status === 'Done' ? 'Enrolled' : status);

// ---------------------------------------------------------------------------
// One place at a time — but only within one intake cycle.
// ---------------------------------------------------------------------------
//
// A student can take up exactly ONE university place for a given start date,
// and for a MOHE/Kuwait Cultural Office sponsored student the KCO approves one
// programme — which is what the Confirmation stage records. So once an
// application reaches Confirmation, its siblings must stop.
//
// "Siblings" is the whole subtlety. Scoping the lock to the student outright
// would be wrong, because the same student legitimately runs several cycles
// over time and each is independent:
//
//   • foundation Sep 2026, then Bachelor's year 1 Sep 2027
//   • a resit of that foundation the following year
//   • a Master's now and a second Master's some years later
//   • a place lost to failed conditions or a visa refusal, re-run for the
//     next intake at a different university
//
// Every one of those differs by INTAKE, so the cycle key is the intake. Each
// intake is its own admission cycle end to end — separate application, offer,
// CAS and visa; nothing carries over from the previous one, and deferring is
// not "moving" an application but closing one and opening another.
const PHASE_ORDER = [
  'Initiated',
  'Submitted',
  'Conditional offer',
  'Unconditional offer',
  'Confirmation',
  'FG/BS',
  'CAS Received',
  'Done',
];
const CONFIRMATION_INDEX = PHASE_ORDER.indexOf('Confirmation');

/** How far an application has actually got: the marker, else the last completed phase. */
const reachedPhaseIndex = (application) => {
  const phases = (application && application.portalApplicationStatus && application.portalApplicationStatus.applicationPhases) || [];
  if (!phases.length) return -1;
  const marked = phases.findIndex((p) => p && p.phaseState === 'AwaitingResponseStudent');
  if (marked !== -1) return PHASE_ORDER.indexOf(phases[marked].status);
  const current = phases.findIndex((p) => p && p.isCurrent);
  if (current !== -1) return PHASE_ORDER.indexOf(phases[current].status);
  let best = -1;
  phases.forEach((p) => {
    if (p && p.phaseState === 'Completed') best = Math.max(best, PHASE_ORDER.indexOf(p.status));
  });
  return best;
};

/**
 * Which admission cycle an application belongs to.
 *
 * Applications with no intake recorded all land in one bucket rather than each
 * becoming its own cycle: grouping them keeps the lock working for the case it
 * exists for (several universities, one start date), where letting them float
 * free would quietly disable it for older records.
 */
const cycleKeyOf = (application) => {
  const month = String((application && application.intakeMonth) || '').trim().toLowerCase();
  const year = String((application && application.intakeYear) || '').trim();
  if (!month && !year) return 'intake:unknown';
  return `intake:${year}:${month}`;
};

/**
 * The application, if any, that already holds this student's place for the
 * same intake. Applications belonging to a CLOSED journey are excluded — a
 * past cycle's enrolment must not freeze the cycle the student is in now.
 */
const findCycleHolder = async (application, student) => {
  const siblings = await applicationService.getApplicationByStudentId(application.studentId);
  const pastIds = new Set();
  ((student && student.journeys) || []).forEach((j) => {
    ((j && j.applications) || []).forEach((id) => pastIds.add(String(id)));
  });
  const key = cycleKeyOf(application);
  return (
    siblings.find(
      (a) =>
        String(a._id) !== String(application._id) &&
        !a.rejected &&
        !pastIds.has(String(a._id)) &&
        cycleKeyOf(a) === key &&
        reachedPhaseIndex(a) >= CONFIRMATION_INDEX
    ) || null
  );
};


// const { fatoorah } = require('../thirdparty');
// const { DateToString } = require('../utils/Common');
// const { PubSub } = require('@google-cloud/pubsub');
// const pubSubClient = new   PubSub();

const SLACK_API_URL = 'https://slack.com/api/chat.postMessage';
const SLACK_TOKEN = process.env.SLACK_NOTIFICATION;

const sendSlackNotification = async (memberId, slackBody) => {
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
      console.log('Slack notification sent successfully.');
    } else {
      console.error('Error sending Slack notification:', response.data.error);
    }
  } catch (error) {
    console.error('Error sending Slack notification:', error.message);
  }
};
// ---------------------------------------------------------------------------
// Sub-agent submission helpers
// ---------------------------------------------------------------------------

// A student "belongs to" a user when that user created them or is assigned to
// them. `createdBy` is the authoritative half (server-set); `assignedTo` is
// kept because it is how staff assignment already works and because students
// created before this deploy have no createdBy at all.
const studentBelongsTo = (student, userId) => {
  if (!student || !userId) return false;
  if (student.createdBy && String(student.createdBy) === String(userId)) return true;
  return (student.assignedTo || []).some((a) => a && a.user && String(a.user) === String(userId));
};

const applicationLabel = (application) =>
  `${(application.institute && application.institute.name) || 'an institution'} - ${application.courseName || 'a course'}`;

// Tell every reviewer a sub-agent has submitted (or resubmitted) an application.
const notifyReviewersOfApplication = async (io, application, actor, resubmitted) => {
  const users = await userService.getUsers();
  const recipientIds = users.filter((u) => roleAccess.isReviewer(u)).map((u) => u._id.toString());
  if (!recipientIds.length) return;
  await notificationsService.createNotification(
    io,
    recipientIds,
    // Name WHO submitted — "Dana Yousef (American International School)" —
    // rather than assuming every partner is a sub-agent. `actor` is the
    // resolved User doc, so organisation is available when set.
    `${(actor && actor.name) || 'A partner'}${actor && actor.organisation ? ` (${actor.organisation})` : ''} ${
      resubmitted ? 'resubmitted' : 'submitted'
    } an application for review: ${applicationLabel(application)}.`,
    'application',
    application.studentId,
    application.id,
    actor && actor.id
  );
};

// Tell the submitting sub-agent what a counsellor decided. Recipient is the
// application's createdBy -- the same field the ownership queries use, so a
// sub-agent is never notified about an application it cannot see.
const notifySubAgentOfApplicationDecision = async (io, application, decision, reviewer, note) => {
  if (!application.createdBy) return;
  const verb = { APPROVED: 'approved', REJECTED: 'rejected', RETURNED_FOR_EDIT: 'returned for edit' }[decision] || 'updated';
  await notificationsService.createNotification(
    io,
    [application.createdBy.toString()],
    `Your application for ${applicationLabel(application)} was ${verb}${note ? `: ${note}` : '.'}`,
    'application',
    application.studentId,
    application.id,
    reviewer && reviewer.id
  );
};

// The only fields a sub-agent may change, and only while an application is
// RETURNED_FOR_EDIT. Everything else -- phases, status, ownership, review state
// -- is staff-owned and silently dropped rather than merged.
const SUB_AGENT_EDITABLE_FIELDS = [
  'courseName',
  'courseLevel',
  'intakeMonth',
  'intakeYear',
  'campus',
  'comments',
  'institute',
  'course',
  'provider',
  'finalChoice',
  'bachelorYear',
];

const createApplication = catchAsync(async (req, res) => {
  // ---- sub-agent guard rails, before anything is written ----
  // Resolve WHO is creating this.
  //
  // `req.user` alone is not enough. This route runs behind legacyGate, which is
  // softAuth while APPLICATION_AUTH is off: an unauthenticated request passes
  // through with req.user undefined. Access tokens also expire after 30
  // minutes. Either way a school counsellor would have been read as "not a
  // partner" and their application created APPROVED — straight past review.
  //
  // So when there is no session, fall back to the actor the client names and
  // look up their real role. The role always comes from the database; the body
  // only ever supplies an id to look up.
  let actor = req.user;
  if (!actor) {
    const claimedId = req.body && req.body.editor && req.body.editor.id;
    if (claimedId && mongoose.isValidObjectId(claimedId)) {
      actor = await userService.getUserById(claimedId).catch(() => null);
    }
  }
  const actorIsSubAgent = isSubAgent(actor);
  // A school counsellor may only open an application for a student the
  // internal team has already approved. Before approval the student sits in
  // PendingReview (or Denied), and an application at that point would put an
  // unvetted student into the review queue twice. Server-side, because the
  // portal hiding its Apply button is not access control.
  if (isSchoolCounselor(actor) && req.body.studentId) {
    const target = await studentsService.getStudentById(req.body.studentId);
    if (target && ['PendingReview', 'Denied'].includes(target.stage)) {
      throw new ApiError(
        httpStatus.FORBIDDEN,
        'This student is still being reviewed by Ulearn — applications open once they are approved.'
      );
    }
  }
  // A school counsellor is ALSO a partner whose work needs review. Without
  // this the ternary below fell through to 'APPROVED', so a counsellor-created
  // application went straight into the live pipeline with no reviewer ever
  // seeing it — the exact opposite of the requirement.
  const actorIsCounselorPartner = isSchoolCounselor(actor);
  const actorIsPartner = actorIsSubAgent || actorIsCounselorPartner;

  // Ownership, review state and the decision log are server-owned. Stripping
  // them here is what stops a sub-agent self-approving, or attributing an
  // application to another agent, by putting those fields in the body.
  delete req.body.createdBy;
  delete req.body.createdByRole;
  delete req.body.reviewStatus;
  delete req.body.reviewHistory;

  if (actorIsSubAgent) {
    const target = await studentsService.getStudentById(req.body.studentId);
    if (!target || !studentBelongsTo(target, actor.id)) {
      // 404 rather than 403 on purpose: a sub-agent walking student ids should
      // not be able to tell "exists but not yours" from "does not exist".
      throw new ApiError(httpStatus.NOT_FOUND, 'Student not found');
    }

    // Whitelist the body, matching resubmitApplication. Deleting the four
    // ownership fields above is not enough on its own: `status`, `rejected`,
    // `managedBy`, `applicationId`, `agent` and `documents` are all staff-owned
    // and feed staff views, and a blacklist would silently admit any field
    // added to the schema later.
    const allowedOnCreate = [...SUB_AGENT_EDITABLE_FIELDS, 'studentId'];
    const filtered = {};
    allowedOnCreate.forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) filtered[field] = req.body[field];
    });
    req.body = filtered;
  }

  const startDate = new Date();
  const stages = [
    {
      status: 'Initiated',
      phaseState: 'Completed',
      isCurrent: false,
      isPrevious: true,
      createdDate: '',
      subApplicationPhase: [],
      closedStatus: null,
      offerStatus: null,
    },
    {
      status: 'Submitted',
      phaseState: 'AwaitingResponseStudent',
      isCurrent: true,
      isPrevious: false,
      createdDate: '',
      subApplicationPhase: [],
      closedStatus: null,
      offerStatus: null,
    },
    {
      status: 'Conditional offer',
      phaseState: 'Upcoming',
      isCurrent: false,
      isPrevious: false,
      createdDate: '',
      subApplicationPhase: [],
      closedStatus: null,
      offerStatus: null,
    },
    {
      status: 'Unconditional offer',
      phaseState: 'Upcoming',
      isCurrent: false,
      isPrevious: false,
      createdDate: '',
      subApplicationPhase: [],
      closedStatus: null,
      offerStatus: null,
    },
    {
      status: 'Confirmation',
      phaseState: 'Upcoming',
      isCurrent: false,
      isPrevious: false,
      createdDate: '',
      subApplicationPhase: [],
      closedStatus: null,
      offerStatus: null,
    },
    {
      status: 'FG/BS',
      phaseState: 'Upcoming',
      isCurrent: false,
      isPrevious: false,
      createdDate: '',
      subApplicationPhase: [],
      closedStatus: null,
      offerStatus: null,
    },
    {
      status: 'CAS Received',
      phaseState: 'Upcoming',
      isCurrent: false,
      isPrevious: false,
      createdDate: '',
      subApplicationPhase: [],
      closedStatus: null,
      offerStatus: null,
    },
    {
      status: 'Done',
      phaseState: 'Upcoming',
      isCurrent: false,
      isPrevious: false,
      createdDate: '',
      subApplicationPhase: [],
      closedStatus: null,
      offerStatus: null,
    },
  ];

  const application = await applicationService.createApplication({
    ...req.body,
    // A partner submission has not been worked yet: it starts at Initiated,
    // the stage the requirement names for a newly approved application. The
    // default `stages` above are the STAFF shape (Initiated done, Submitted
    // current) and stay untouched for staff so their pipeline is unchanged.
    portalApplicationStatus: {
      applicationPhases: (actorIsPartner
        ? stages.map((p, idx) => ({
            ...p,
            isCurrent: idx === 0,
            isPrevious: false,
            // 'AwaitingResponseStudent' / 'Upcoming', NOT 'InProgress' / ''.
            // Those two were invented here and nothing else understands them:
            // with no AwaitingResponseStudent phase on the record, the
            // phase-change handler below falls through its scan to the
            // `|| status === 'Done'` fallback and treats a staff member's very
            // first advance on a partner-referred application as "moved to
            // Enrolled" — notifying everyone and (now) enrolling the student.
            // The back office's stage modal reads the same marker and throws
            // on undefined without it.
            phaseState: idx === 0 ? 'AwaitingResponseStudent' : 'Upcoming',
          }))
        : stages
      // The phase the application opens on starts its SLA clock now. Left as
      // the literal '' it was declared with, the clock had no start to measure
      // from on the very first stage — the one with the tightest allowance.
      ).map((p) =>
        p.phaseState === 'AwaitingResponseStudent' ? { ...p, createdDate: startDate } : p
      ),
    },
    startDate,
    // Server-side attribution. With the legacy gate off and no token presented,
    // req.user is undefined and this falls back to the editor id the CRM
    // already sends -- unchanged behaviour for existing staff callers.
    createdBy: (actor && actor.id) || (req.body.editor && req.body.editor.id) || undefined,
    createdByRole: (actor && roleIdOf(actor)) || undefined,
    // Staff applications stay APPROVED, so the existing pipeline is untouched.
    // Each partner gets its own submitted state; see the model comment.
    // eslint-disable-next-line no-nested-ternary
    reviewStatus: actorIsSubAgent
      ? 'SUBMITTED_BY_SUBAGENT'
      : actorIsCounselorPartner
      ? 'SUBMITTED_BY_COUNSELOR'
      : 'APPROVED',
    reviewHistory: actorIsPartner ? [{ action: 'SUBMITTED', by: actor.id, byName: actor.name, at: new Date() }] : [],
  });

  // A PARTNER submission is not a live application yet -- it waits for a
  // reviewer. Skip the staff Slack/assignment fan-out below (which also
  // expects req.body.editor, something the portals do not send) and instead
  // alert the reviewers. Covers school counsellors as well as sub-agents;
  // gating this on isSubAgent alone would have sent a counsellor submission
  // down the staff path and crashed on the missing editor.
  if (actorIsPartner) {
    // Timeline: the portal's Recent updates reads per-student activities, so a
    // submission that only produced a notification would be invisible there.
    try {
      await activitiesService.logActivity({
        student: application.studentId,
        type: 'stage',
        text: `${(actor && actor.name) || 'A partner'} submitted an application for ${
          (application.institute && application.institute.name) || application.courseName || 'a course'
        } — awaiting Ulearn review`,
        actorId: actor && actor.id,
        actorName: actor && actor.name,
        meta: { applicationId: application.id },
      });
    } catch (err) {
      console.error('Application submission activity failed:', err.message);
    }

    // Attach the new application to the student SERVER-SIDE for partners.
    // Staff do this client-side (StartApplication PATCHes student.applications),
    // but a partner's PATCH runs through the editable-field whitelist, which
    // does not — and must not — include `applications`: whitelisting it would
    // let a partner detach or reattach applications at will. $addToSet keeps
    // the write idempotent.
    try {
      const { Students } = require('../models');
      await Students.updateOne({ _id: application.studentId }, { $addToSet: { applications: application.id } });
    } catch (err) {
      console.error('Attaching application to student failed:', err.message);
    }
    try {
      await notifyReviewersOfApplication(req.app.get('io'), application, actor, false);
    } catch (err) {
      console.error('Application review-submission notification failed:', err.message);
    }
    return res.status(httpStatus.CREATED).send(application);
  }

  const student = await studentsService.getStudentById(application.studentId);
  const { assignedTo } = student;

  const users = await userService.getUsers();

  const updatedUsers = users
    .filter((user) => assignedTo.some((assignment) => assignment.user.equals(user._id)))
    .flatMap((user) => {
      const assignedRoles = assignedTo
        .filter((assignment) => assignment.user.equals(user._id))
        .map((assignment) => assignment.role);

      return assignedRoles.map((role) => ({
        ...user._doc, // Destructure the actual document to avoid internal fields
        assignedAs: role,
      }));
    });

  const simplifiedUsers = updatedUsers.map((user) => {
    return {
      _id: user._id,
      name: user.name,
      email: user.email,
      slackMemberId: user.slackMemberId,
      avatar: user.avatar,
      assignedAs: user.assignedAs,
    };
  });

  // Deduplicate users by slackMemberId
  const deduplicatedUsers = Array.from(new Map(simplifiedUsers.map((user) => [user.slackMemberId, user])).values());

  const slackBody = {
    attachments: [
      {
        pretext: `*An application has been initiated by ${req.body.editor.name} for ${student.firstName || ''} ${
          student.middleName || ''
        } ${student.lastName || ''}*`,
        text: `\nApplication No - ${application.applicationId}.\nUniversity - ${application.institute.name}.\nDegree - ${application.courseLevel}.\nCourse - ${application.courseName}.\nIntake - ${application.intakeMonth} ${application.intakeYear}`,
        color: '#FFFF00',
      },
    ],
  };

  // Send notifications to deduplicated users
  // if (process.env.APP_ENV === 'production') {

  await Promise.all(deduplicatedUsers.map((user) => sendSlackNotification(user.slackMemberId, slackBody)));
  const io = req.app.get('io');

  await notificationsService.createNotification(
    io,
    deduplicatedUsers.map((user) => user._id.toString()),
    slackBody.attachments[0].pretext,
    'application',
    student.id,
    application.id,
    req.body.editor.id
  );
  // }
  res.status(httpStatus.CREATED).send(application);
});

const getApplications = catchAsync(async (req, res) => {
  // await publishMessage();

  // A sub-agent hitting the staff list endpoint gets its OWN applications, not
  // a filtered view of everyone's. The narrowing is a different query, not a
  // post-filter, so other agents' documents are never read.
  if (isSubAgent(req.user)) {
    const own = await applicationService.getApplicationsForOwner(req.user.id, {});
    return res.send(own);
  }

  const result = await applicationService.getApplications(req.query);
  return res.send(result);
});

/**
 * Strip internal identities from anything a PARTNER reads.
 *
 * `reviewHistory` carries `by` and `byName` — the Ulearn reviewer who approved
 * or rejected. The decision itself and its reason are the partner's business;
 * which member of staff made it is not. The school portal was rendering
 * "reason — Reviewer Name" straight onto the application card, which is the
 * exact leak the counsellor timeline already guards against by attributing
 * everything internal to "the Ulearn team".
 *
 * Done on the SERVER rather than in the component, so a future screen cannot
 * reintroduce it by reading a field that was never supposed to arrive.
 */
const stripInternalIdentity = (doc) => {
  if (!doc) return doc;
  const plain = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
  if (Array.isArray(plain.reviewHistory)) {
    plain.reviewHistory = plain.reviewHistory.map((h) => {
      const { by, byName, ...rest } = h || {};
      return rest;
    });
  }
  return plain;
};

const forPartner = (req, payload) => {
  if (!isExternalPartner(req.user)) return payload;
  return Array.isArray(payload) ? payload.map(stripInternalIdentity) : stripInternalIdentity(payload);
};

const getApplication = catchAsync(async (req, res) => {
  // Ownership is part of the lookup for a sub-agent, so a guessed id returns
  // 404 exactly as a non-existent one does.
  const application = isSubAgent(req.user)
    ? await applicationService.getApplicationForOwner(req.params.applicationId, req.user.id)
    : await applicationService.findApplicationById(req.params.applicationId);

  if (!application) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Application not found');
  }
  res.send(forPartner(req, application));
});
/**
 * GET /v1/application/mine-school — a school counsellor's own applications.
 *
 * Scoped by STUDENT ownership, resolved server-side from the session. The
 * client sends no filter, so there is nothing for a caller to tamper with.
 */
const getMySchoolApplications = catchAsync(async (req, res) => {
  const own = await studentsService.queryStudents(
    { $or: [{ createdBy: req.user.id }, { 'assignedTo.user': req.user.id }] },
    { limit: 500, page: 1 },
  );
  const studentIds = (own.results || []).map((st) => st.id || st._id);
  const applications = await applicationService.getApplicationsForStudents(studentIds);
  res.send({ results: forPartner(req, applications) });
});

const getApplicationByStudentId = catchAsync(async (req, res) => {
  // A school counsellor reads applications through the STUDENT they own, not
  // through application.createdBy (Ulearn staff create the applications for
  // their referrals). Verify ownership of the student, then return everything
  // for that student. 404 on a foreign id, same as /students/:id.
  if (isSchoolCounselor(req.user)) {
    const student = await studentsService.getStudentById(req.params.studentId);
    const owns =
      student &&
      ((student.createdBy && String(student.createdBy) === String(req.user.id)) ||
        (student.assignedTo || []).some((a) => a && a.user && String(a.user) === String(req.user.id)));
    if (!owns) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Application not found');
    }
    return res.send(
      forPartner(req, await applicationService.getApplicationByStudentId(req.params.studentId)),
    );
  }

  const application = isSubAgent(req.user)
    ? await applicationService.getApplicationsByStudentForOwner(req.params.studentId, req.user.id)
    : await applicationService.getApplicationByStudentId(req.params.studentId);

  if (!application) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Application not found');
  }
  res.send(forPartner(req, application));
});

const updateApplication = catchAsync(async (req, res) => {
  // Sub-agents never advance an application. The one edit they are allowed --
  // fixing a submission a counsellor returned -- goes through the dedicated
  // resubmitApplication endpoint with a field whitelist, so this generic PATCH
  // (which can rewrite phases and status) is closed to them outright. Route
  // middleware denies this too; the check is repeated here so the rule holds
  // even if the route is later remounted without it.
  // isExternalPartner, NOT isSubAgent: the rule ("a partner never advances an
  // application") applies to both partner roles, and gating on isSubAgent left
  // school counsellors able to PATCH phases and status outright.
  if (isExternalPartner(req.user)) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Partners cannot update an application');
  }
  try {
    if (req.body.phaseChanged) {
      const stages = req.body.portalApplicationStatus.applicationPhases;
      // Which phase is being completed. The marker is AwaitingResponseStudent;
      // isCurrent is the repair path for records written before that was set
      // consistently — without it the old `|| status === 'Done'` fallback
      // silently matched the FINAL phase and every advance on such a record
      // read as "moved to Enrolled". The Done fallback is kept last so a
      // genuinely finished application still resolves.
      let currentIndex = stages.findIndex((stage) => stage.phaseState === 'AwaitingResponseStudent');
      if (currentIndex === -1) currentIndex = stages.findIndex((stage) => stage.isCurrent);
      if (currentIndex === -1) currentIndex = stages.findIndex((stage) => stage.status === 'Done');
      // Captured before the mutation below reassigns phaseStates; this is the
      // stage the notification/Slack messages describe the move as.
      const movedToStatus = currentIndex !== -1 && stages[currentIndex] ? stages[currentIndex].status : null;
      const application = await applicationService.findApplicationById(req.params.applicationId);
      const student = await studentsService.getStudentById(application.studentId);
      const { assignedTo } = student;

      const users = await userService.getUsers();

      const updatedUsers = users
        .filter((user) => assignedTo.some((assignment) => assignment.user.equals(user._id)))
        .flatMap((user) => {
          const assignedRoles = assignedTo
            .filter((assignment) => assignment.user.equals(user._id))
            .map((assignment) => assignment.role);

          // Return a separate user object for each assigned role
          return assignedRoles.map((role) => ({
            ...user._doc, // Destructure the actual document to avoid the internal fields
            assignedAs: role,
          }));
        });

      const usersWithRoles = updatedUsers;
      const filledBy = users.filter((user) => application.managedBy == user._id)
        ? users.filter((user) => application.managedBy == user._id)
        : [{ name: '' }];

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

      let slackBody = {};
      const accountManager = simplifiedUsers.filter((z) => z.assignedAs === 'account manager')[0];
      const sales = simplifiedUsers.filter((z) => z.assignedAs === 'sales')[0];
      const operations = simplifiedUsers.filter((z) => z.assignedAs === 'operations')[0];

      // Define conditions based on different application statuses. `movedTo`
      // is the guarded read — `stages[currentIndex]` was dereferenced directly
      // here, so a record the scan above could not resolve threw inside the
      // try/catch, which logs and never sends a response: the request hung.
      const movedTo = movedToStatus;

      // Enforce one place per intake cycle SERVER-SIDE. The screens disable
      // the button, but that is a courtesy: the rule decides whether a student
      // ends up holding two places, so it cannot live only in the UI.
      if (PHASE_ORDER.indexOf(movedTo) >= CONFIRMATION_INDEX) {
        const holder = await findCycleHolder(application, student);
        if (holder) {
          const where = (holder.institute && holder.institute.name) || holder.courseName || 'another application';
          const when =
            holder.intakeMonth || holder.intakeYear
              ? ` for ${[holder.intakeMonth, holder.intakeYear].filter(Boolean).join(' ')}`
              : '';
          throw new ApiError(
            httpStatus.CONFLICT,
            `${where} is already this student's confirmed choice${when}. A student can hold one place per intake — move that application back below Confirmation first, or use a different intake.`
          );
        }
      }

      if (movedTo === 'Submitted') {
        slackBody = {
          attachments: [
            {
              pretext: `*An application has been moved to Submitted by ${req.body.editor.name} for ${
                student.firstName || ''
              } ${student.middleName || ''} ${student.lastName || ''}*`,
              text: `\nApplication No - ${application.applicationId}.\nUniversity - ${
                application.institute.name
              }.\nDegree - ${application.courseLevel}.\nCourse - ${application.courseName}.\nIntake - ${
                application.intakeMonth
              } ${application.intakeYear}\nAccount Manager - ${accountManager ? accountManager.name : ''}\nSales - ${
                sales ? sales.name : ''
              }\nOperation - ${operations ? operations.name : ''}\nFilled out by - ${
                filledBy.length ? filledBy[0].name : ''
              }`,
              color: '#00FF00',
            },
          ],
        };
      } else if (movedTo === 'Conditional offer') {
        slackBody = {
          attachments: [
            {
              pretext: `*An application has been moved to Conditional offer by ${req.body.editor.name} for ${
                student.firstName || ''
              } ${student.middleName || ''} ${student.lastName || ''}*`,
              text: `\nApplication No - ${application.applicationId}.\nUniversity - ${
                application.institute.name
              }.\nDegree - ${application.courseLevel}.\nCourse - ${application.courseName}.\nIntake - ${
                application.intakeMonth
              } ${application.intakeYear}\nAccount Manager - ${accountManager ? accountManager.name : ''}\nSales - ${
                sales ? sales.name : ''
              }\nOperation - ${operations ? operations.name : ''}\nFilled out by - ${
                filledBy.length ? filledBy[0].name : ''
              }`,
              color: '#FFFF00',
            },
          ],
        };
      } else if (movedTo === 'Unconditional offer') {
        slackBody = {
          attachments: [
            {
              pretext: `*An application has been moved to UnConditional offer by ${req.body.editor.name} for ${
                student.firstName || ''
              } ${student.middleName || ''} ${student.lastName || ''}*`,
              text: `\nApplication No - ${application.applicationId}.\nUniversity - ${
                application.institute.name
              }.\nDegree - ${application.courseLevel}.\nCourse - ${application.courseName}.\nIntake - ${
                application.intakeMonth
              } ${application.intakeYear}\nAccount Manager - ${accountManager ? accountManager.name : ''}\nSales - ${
                sales ? sales.name : ''
              }\nOperation - ${operations ? operations.name : ''}\nFilled out by - ${
                filledBy.length ? filledBy[0].name : ''
              }`,
              color: '#FFFF00',
            },
          ],
        };
      } else if (movedTo === 'Confirmation') {
        slackBody = {
          attachments: [
            {
              pretext: `*An application has been moved to Confirmation by ${req.body.editor.name} for ${
                student.firstName || ''
              } ${student.middleName || ''} ${student.lastName || ''}*`,
              text: `\nApplication No - ${application.applicationId}.\nUniversity - ${
                application.institute.name
              }.\nDegree - ${application.courseLevel}.\nCourse - ${application.courseName}.\nIntake - ${
                application.intakeMonth
              } ${application.intakeYear}\nAccount Manager - ${accountManager ? accountManager.name : ''}\nSales - ${
                sales ? sales.name : ''
              }\nOperation - ${operations ? operations.name : ''}\nFilled out by - ${
                filledBy.length ? filledBy[0].name : ''
              }`,
              color: '#FFFF00',
            },
          ],
        };
      } else if (movedTo === 'FG/BS') {
        slackBody = {
          attachments: [
            {
              pretext: `*An application has been moved to FG/BS by ${req.body.editor.name} for ${student.firstName || ''} ${
                student.middleName || ''
              } ${student.lastName || ''}*`,
              text: `\nApplication No - ${application.applicationId}.\nUniversity - ${
                application.institute.name
              }.\nDegree - ${application.courseLevel}.\nCourse - ${application.courseName}.\nIntake - ${
                application.intakeMonth
              } ${application.intakeYear}\nAccount Manager - ${accountManager ? accountManager.name : ''}\nSales - ${
                sales ? sales.name : ''
              }\nOperation - ${operations ? operations.name : ''}\nFilled out by - ${
                filledBy.length ? filledBy[0].name : ''
              }`,
              color: '#FFFF00',
            },
          ],
        };
      } else if (movedTo === 'CAS Received') {
        slackBody = {
          attachments: [
            {
              pretext: `*An application has been moved to CAS Received by ${req.body.editor.name} for ${
                student.firstName || ''
              } ${student.middleName || ''} ${student.lastName || ''}*`,
              text: `\nApplication No - ${application.applicationId}.\nUniversity - ${
                application.institute.name
              }.\nDegree - ${application.courseLevel}.\nCourse - ${application.courseName}.\nIntake - ${
                application.intakeMonth
              } ${application.intakeYear}\nAccount Manager - ${accountManager ? accountManager.name : ''}\nSales - ${
                sales ? sales.name : ''
              }\nOperation - ${operations ? operations.name : ''}\nFilled out by - ${
                filledBy.length ? filledBy[0].name : ''
              }`,
              color: '#FFFF00',
            },
          ],
        };
      } else {
        slackBody = {
          attachments: [
            {
              pretext: `*An application has been moved to Done by ${req.body.editor.name} for ${student.firstName || ''} ${
                student.middleName || ''
              } ${student.lastName || ''}*`,
              text: `\nApplication No - ${application.applicationId}.\nUniversity - ${
                application.institute.name
              }.\nDegree - ${application.courseLevel}.\nCourse - ${application.courseName}.\nIntake - ${
                application.intakeMonth
              } ${application.intakeYear}\nAccount Manager - ${accountManager ? accountManager.name : ''}\nSales - ${
                sales ? sales.name : ''
              }\nOperation - ${operations ? operations.name : ''}\nFilled out by - ${
                filledBy.length ? filledBy[0].name : ''
              }`,
              color: '#FFFF00',
            },
          ],
        };
      }
      const io = req.app.get('io');
      // Send the Slack notification if in production environment
      if (process.env.APP_ENV === 'production') {
        await Promise.all(simplifiedUsers.map((user) => sendSlackNotification(user.slackMemberId, slackBody)));
      }

      await notificationsService.createNotification(
        io,
        simplifiedUsers.map((user) => user._id.toString()),
        slackBody.attachments[0].pretext,
        'application',
        student.id,
        application.id,
        req.body.editor.id
      );

      // The school counsellor who referred this student follows the same
      // milestone from their portal — notify them too, in portal wording
      // rather than the staff Slack pretext (which names staff and internal
      // assignments they should never see). Counsellor-only by decision: the
      // sub-agent portal's behaviour stays as it is. Non-fatal: a failed
      // partner ping must not block the phase move itself.
      try {
        const ownerId = student.createdBy && String(student.createdBy);
        const alreadyNotified = ownerId && simplifiedUsers.some((u) => String(u._id) === ownerId);
        const owner = ownerId && !alreadyNotified ? await userService.getUserById(ownerId).catch(() => null) : null;
        if (owner && isSchoolCounselor(owner)) {
          const studentName = `${student.firstName || ''} ${student.lastName || ''}`.trim() || 'Your student';
          const uni = (application.institute && application.institute.name) || application.courseName || 'the university';
          await notificationsService.createNotification(
            io,
            [ownerId],
            `${studentName}'s application to ${uni} has moved to ${phaseLabel(movedToStatus)}.`,
            'application',
            student.id,
            application.id,
            req.body.editor && req.body.editor.id
          );
        }
      } catch (err) {
        console.error('Partner phase notification failed:', err.message);
      }

      // `holdPhase` opt-in: the caller has ALREADY positioned the marker on the
      // phase being recorded and wants it left there. Screens that ask for the
      // phase's details up front (pick the stage, fill in what it needs, land
      // on it) need this — without it the pointer is advanced a second time
      // here and one click moves two stages. Callers that do not send the flag
      // keep the original behaviour exactly: record the current phase, then
      // step to the next.
      if (currentIndex !== -1 && req.body.holdPhase !== true) {
        // Update 'AwaitingResponseStudent' to 'Completed' and set isCurrent to false
        stages[currentIndex].phaseState = 'Completed';
        stages[currentIndex].isCurrent = false;
        stages[currentIndex].isPrevious = true;

        // Check if the next stage exists and update its phaseState to 'AwaitingResponseStudent' with isCurrent set to true
        if (currentIndex < stages.length - 1) {
          stages[currentIndex + 1].phaseState = 'AwaitingResponseStudent';
          stages[currentIndex + 1].isCurrent = true;
        }
        if (currentIndex >= 0) {
          stages[currentIndex - 1].isPrevious = false;
        }
      }

      // ---- Stamp when each phase was entered and left -------------------
      //
      // `createdDate` / `updatedDate` have been on the phase schema all along
      // but nothing ever wrote them: applications were created with
      // `createdDate: ''` and no code touched them again. The SLA engine reads
      // "when did this phase start" and, finding nothing, falls back to the
      // APPLICATION's `updatedAt` — which every unrelated write bumps (a
      // managedBy change, a document link, a status edit), silently restarting
      // the clock. So every overdue ring, the Students "Overdue" filter and the
      // dashboard's overdue count were measuring from the last time the record
      // was touched rather than from the stage move.
      //
      // Which index just became current depends on who moved the pointer: with
      // holdPhase the caller already positioned it, otherwise it advanced above.
      // Re-stamping is guarded against a `phaseChanged` request that does not
      // actually move the pointer, so an incidental save cannot reset the clock
      // either.
      const stampedAt = new Date();
      const enteredIndex = req.body.holdPhase === true ? currentIndex : currentIndex + 1;
      const storedPhases =
        (application.portalApplicationStatus && application.portalApplicationStatus.applicationPhases) || [];
      const wasAlreadyCurrent =
        storedPhases[enteredIndex] && storedPhases[enteredIndex].phaseState === 'AwaitingResponseStudent';

      if (!wasAlreadyCurrent) {
        if (stages[enteredIndex]) stages[enteredIndex].createdDate = stampedAt;
        // The phase being left is closed off at the same moment.
        const leftIndex = enteredIndex - 1;
        if (leftIndex >= 0 && stages[leftIndex]) stages[leftIndex].updatedDate = stampedAt;
      }

      const app = await applicationService.updateApplicationById(req.params.applicationId, {
        portalApplicationStatus: { applicationPhases: stages },
      });

      // Stepping back below Confirmation releases the place, so the student's
      // other applications for that intake can move again. Without this the
      // firm choice is a one-way door.
      if (PHASE_ORDER.indexOf(movedTo) < CONFIRMATION_INDEX && application.finalChoice) {
        try {
          await applicationService.updateApplicationById(req.params.applicationId, { finalChoice: false });
          const stillHeld = await findCycleHolder({ ...application.toObject(), _id: 'none' }, student);
          if (!stillHeld) await studentsService.updateStudentById(student.id, { onHold: false });
        } catch (err) {
          console.error('Releasing the firm choice failed:', err.message);
        }
      }

      // Timeline: record the phase change (non-fatal). Use the same stage the
      // notification describes so the two agree. `movedToStatus` is captured
      // before the mutation above reassigns phaseStates.
      const editor = actorOf(req);
      const uniName = (application.institute && application.institute.name) || 'Application';
      await activitiesService.logActivity({
        student: student.id,
        type: 'stage',
        text: `${uniName} moved to ${phaseLabel(movedToStatus)}`,
        actorId: editor.id,
        actorName: editor.name,
        meta: { applicationId: application.id, phase: movedToStatus },
      });

      // The final phase enrols the STUDENT, not just the application: the
      // portal's cohort card and student list read student.stage, so without
      // this a student sits on "Applied" forever while their application says
      // Enrolled. Conditional update — fires once even if two staff move
      // phases at the same moment. Non-fatal: the phase move itself already
      // succeeded and must not be rolled back by a stage hiccup.
      if (movedToStatus === 'Done') {
        try {
          const enrolled = await studentsService.advanceStageToEnrolled(student.id);
          if (enrolled) {
            await activitiesService.logActivity({
              student: student.id,
              type: 'stage',
              text: `Journey complete — student enrolled at ${uniName} 🎓`,
              actorId: editor.id,
              actorName: editor.name,
              meta: { applicationId: application.id, stageMove: 'Enrolled' },
            });
          }
        } catch (err) {
          console.error('Enrolled stage advance failed:', err.message);
        }
      }

      res.send(app);
      return;
    }
    const app = await applicationService.updateApplicationById(req.params.applicationId, req.body);
    res.send(app);
  } catch (error) {
    console.log(error);
  }
});

const deleteApplication = catchAsync(async (req, res) => {
  if (isSubAgent(req.user)) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Sub-agents cannot delete an application');
  }
  await applicationService.deleteApplication(req.params.applicationId);
  res.status(httpStatus.NO_CONTENT).send();
});
const getApplicationsByPhase = async (req, res) => {
  try {
    const data = await applicationService.getApplicationsCountByPhase(req.query.startDate, req.query.endDate);
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// const searchApplications = catchAsync(async (req, res) => {
//   // const filter = pick(req.query, ['name', 'status', 'stage']);
//   const options = pick(req.query, ['sortBy', 'limit', 'page', 'populate']);
//   const results = await applicationService.searchCountry(req.params.text, options);
//   res.status(200).send(results);
// });

const getTopUniversities = async (req, res) => {
  try {
    const universities = await applicationService.getTopUniversitiesByApplications(req.query.startDate, req.query.endDate);
    res.send(universities);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

async function getEnrolledUniversities(req, res) {
  try {
    const application = await applicationService.getTopEnrolledUniversities(req.query.startDate, req.query.endDate);
    res.send(application);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

const getApplicationsCountByMonth = catchAsync(async (req, res) => {
  const data = await applicationService.getApplicationsCountByMonth(req.query.intakeMonth, req.query.intakeYear);
  res.status(200).json(data);
});

const getEnrolledApplicationsCountByMonth = catchAsync(async (req, res) => {
  const data = await applicationService.getEnrolledApplicationsCountByMonth(req.query.intakeMonth, req.query.intakeYear);
  res.status(200).json(data);
});

const getDashboardData = catchAsync(async (req, res) => {
  try {
    // The service takes ONE options object. This passed four positional
    // arguments, so it destructured `intakeMonth` — a string — and every
    // field came out undefined: the dashboard's date range and intake filter
    // were silently ignored on every request, and the whole payload was
    // computed unfiltered no matter what the user picked.
    const applicationsData = await applicationService.getDashboardData({
      intakeMonth: req.query.intakeMonth,
      intakeYear: req.query.intakeYear,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
    });

    res.status(200).json({
      applicationsData,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/**
 * GET /application/dashboard-drilldown?metric=submitted|offers
 *
 * The records behind a dashboard KPI. Computed from the same predicates as the
 * totals, so the card and the list it opens can never disagree.
 */
const getDashboardDrilldown = catchAsync(async (req, res) => {
  const rows = await applicationService.getPipelineDrilldown(
    req.query.metric,
    req.query.startDate,
    req.query.endDate
  );
  res.send(rows);
});

// ---------------------------------------------------------------------------
// Sub-agent portal + counsellor review endpoints
// ---------------------------------------------------------------------------

// GET /application/mine -- the signed-in sub-agent's own applications.
// The owner id comes from the session; there is deliberately no way to pass
// someone else's id in.
const getMyApplications = catchAsync(async (req, res) => {
  const applications = await applicationService.getApplicationsForOwner(req.user.id, {
    reviewStatus: req.query.reviewStatus,
  });
  res.send(applications);
});

// GET /application/pending-review -- the counsellor queue.
const getPendingReviewApplications = catchAsync(async (req, res) => {
  const applications = await applicationService.getApplicationsPendingReview({});
  res.send(applications);
});

// POST /application/:applicationId/review -- approve / reject / return.
// Reviewer-only, and the transition is validated against the application's
// CURRENT state, so a replayed or crafted request cannot skip a step.
const reviewApplication = catchAsync(async (req, res) => {
  const { decision, note } = req.body;
  const allowed = ['APPROVED', 'REJECTED', 'RETURNED_FOR_EDIT'];
  if (!allowed.includes(decision)) {
    throw new ApiError(httpStatus.BAD_REQUEST, `decision must be one of ${allowed.join(', ')}`);
  }
  if ((decision === 'REJECTED' || decision === 'RETURNED_FOR_EDIT') && !String(note || '').trim()) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'A note is required when rejecting or returning an application');
  }

  const application = await applicationService.findApplicationById(req.params.applicationId);
  if (!application) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Application not found');
  }

  // A reviewer must not be able to decide on their own submission. Belt and
  // braces: requireReviewer already excludes sub-agents, but roles change.
  if (application.createdBy && String(application.createdBy) === String(req.user.id)) {
    throw new ApiError(httpStatus.FORBIDDEN, 'You cannot review an application you submitted');
  }

  const from = application.reviewStatus;
  if (!applicationService.canTransition(from, decision)) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Cannot move an application from ${from} to ${decision}`);
  }

  // Conditional on `from`, so simultaneous approve/reject clicks cannot both
  // land -- the loser gets the 409 below rather than silently overwriting.
  const updated = await applicationService.applyReviewDecision(req.params.applicationId, {
    from,
    to: decision,
    action: decision === 'APPROVED' ? 'APPROVED' : decision,
    by: req.user.id,
    byName: req.user.name,
    note,
  });
  if (!updated) {
    throw new ApiError(httpStatus.CONFLICT, 'This application was already reviewed by someone else');
  }

  // Timeline: the decision itself, whatever it was. (The stage move below has
  // its own entry, logged only when it actually happens.)
  try {
    await activitiesService.logActivity({
      student: updated.studentId,
      type: 'stage',
      text: `${req.user.name || 'A reviewer'} ${decision === 'APPROVED' ? 'approved' : 'rejected'} the application for ${
        (updated.institute && updated.institute.name) || updated.courseName || 'a course'
      }${note ? `: ${note}` : ''}`,
      actorId: req.user.id,
      actorName: req.user.name,
      meta: { applicationId: updated.id, decision },
    });
  } catch (err) {
    console.error('Review decision activity failed:', err.message);
  }

  // Approving a SCHOOL COUNSELLOR's application also moves the student into the
  // pipeline: stage -> 'Applied', but only from 'NotApplied' (the condition
  // lives inside the query — see advanceStageToApplied for why). Scoped to the
  // counsellor state on purpose: sub-agent approvals keep their existing
  // behaviour, per the "sub-agent portal unchanged" constraint.
  if (decision === 'APPROVED' && from === 'SUBMITTED_BY_COUNSELOR' && updated.studentId) {
    try {
      const moved = await studentsService.advanceStageToApplied(updated.studentId);
      if (moved) {
        await activitiesService.logActivity({
          student: updated.studentId,
          type: 'stage',
          text: `${req.user.name || 'A reviewer'} approved an application — student moved to Applied`,
          actorId: req.user.id,
          actorName: req.user.name,
          meta: { applicationId: updated.id },
        });
      }
    } catch (err) {
      // The review decision itself succeeded; a failed stage move must not
      // roll it back. Log and continue — the timeline just misses one entry.
      console.error('Stage advance after approval failed:', err.message);
    }
  }

  try {
    await notifySubAgentOfApplicationDecision(req.app.get('io'), updated, decision, req.user, note);
  } catch (err) {
    console.error('Application decision notification failed:', err.message);
  }

  res.send(updated);
});

// PATCH /application/:applicationId/resubmit -- the ONLY write a sub-agent has
// on an existing application, and only while it is RETURNED_FOR_EDIT.
const resubmitApplication = catchAsync(async (req, res) => {
  const application = await applicationService.getApplicationForOwner(req.params.applicationId, req.user.id);
  if (!application) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Application not found');
  }
  if (application.reviewStatus !== 'RETURNED_FOR_EDIT') {
    throw new ApiError(httpStatus.FORBIDDEN, 'This application is not open for editing');
  }

  // Whitelist, not blacklist: anything not named here is dropped rather than
  // merged, so a field added to the schema later is closed by default.
  const $set = { reviewStatus: 'SUBMITTED_BY_SUBAGENT' };
  SUB_AGENT_EDITABLE_FIELDS.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(req.body, field)) {
      $set[field] = req.body[field];
    }
  });

  // Conditional on ownership AND the current review state, in one atomic write
  // -- the same shape as applyReviewDecision. A read-modify-write here would
  // let a resubmission that started before a counsellor's decision land after
  // it, silently reopening an application that had just been approved.
  const updated = await Application.findOneAndUpdate(
    { _id: req.params.applicationId, createdBy: req.user.id, reviewStatus: 'RETURNED_FOR_EDIT' },
    {
      $set,
      $push: {
        reviewHistory: {
          action: 'RESUBMITTED',
          by: req.user.id,
          byName: req.user.name,
          note: req.body.note,
          at: new Date(),
        },
      },
    },
    // runValidators because findOneAndUpdate skips them by default, unlike the
    // document .save() this replaced -- without it bachelorYear's enum and
    // intakeYear's Number cast would stop being enforced on a resubmission.
    { new: true, runValidators: true }
  );
  if (!updated) {
    throw new ApiError(httpStatus.CONFLICT, 'This application was reviewed again while you were editing it');
  }

  try {
    await notifyReviewersOfApplication(req.app.get('io'), updated, req.user, true);
  } catch (err) {
    console.error('Application resubmission notification failed:', err.message);
  }

  res.send(updated);
});

module.exports = {
  createApplication,
  getMyApplications,
  getPendingReviewApplications,
  reviewApplication,
  resubmitApplication,
  getApplications,
  getApplication,
  deleteApplication,
  updateApplication,
  getMySchoolApplications,
  getApplicationByStudentId,
  getApplicationsByPhase,
  getTopUniversities,
  getEnrolledUniversities,
  getApplicationsCountByMonth,
  getEnrolledApplicationsCountByMonth,
  getDashboardData,
  getDashboardDrilldown,
  //   searchApplications,
};
