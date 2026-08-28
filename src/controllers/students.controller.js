/* eslint-disable no-nested-ternary */
const httpStatus = require('http-status');
const mongoose = require('mongoose');
const { DateTime } = require('luxon');
const axios = require('axios');
const { convertASTToUTC } = require('../utils/Common');
// const { text } = require('express');
const pick = require('../utils/pick');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');
const { studentsService, userService, notificationsService, activitiesService } = require('../services');
const { isSubAgent, isSchoolCounselor, isExternalPartner } = require('../middlewares/subAgentScope');
const { Students } = require('../models');
const { actorOf } = require('../utils/actor');

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
];

// Extra fields the SCHOOL COUNSELLOR intake collects. Kept separate from the
// list above so the sub-agent portal's accepted field set is byte-for-byte what
// it was — widening the shared list would have quietly granted sub-agents the
// ability to write passport detail they never previously could.
const SCHOOL_COUNSELOR_EXTRA_FIELDS = [
  'passportExpiry',
  'passportIssueDate',
  'civilNumber',
  'placeOfIssue',
  'placeOfBirth',
];

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
      console.error('Review-submission notification failed:', err.message);
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
    },
  ];

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
      console.error('New-journey notification failed:', err.message);
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
          filter.assignedTo = elemMatchConditions[0];
        } else {
          filter.$and = elemMatchConditions.map((condition) => ({ assignedTo: condition }));
        }
      }
    } catch (error) {
      return res.status(400).send({
        message: 'Invalid assignedUsersWithRoles format. Expected JSON array with user and userRole properties.',
        error: error.message,
      });
    }
  }

  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await studentsService.queryStudents(filter, options);
  res.send(result);
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
      console.error('Review-transition notification failed:', err.message);
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
    text: `${editor.name} updated assignments: ${simplifiedUsers
      .map((u) => `${u.name} (${u.assignedAs})`)
      .join(', ')}`,
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
  const results = await studentsService.searchStudent(req.params.text, options);
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

  const sd = convertASTToUTC(startDate, true).toString();
  const ed = convertASTToUTC(endDate, true).toString();

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
