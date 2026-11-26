const roleAccess = require('../../src/services/roleAccess.service');
const { adminRole, userRole, subAgentRole, schoolCounselorRole } = require('../fixtures/role.fixture');
const factories = require('../factories');

const { build, daysBefore, SEED_NOW, PHASES, FEE_TYPES, LEAD_STATUSES, DAY } = factories;

/**
 * The made-up office that tests run against.
 *
 * buildSeed() returns the same records every time it is called: the same
 * people, the same students, the same ids and the same dates. So a test can
 * say "sub-agent A has four students" and be right every time.
 *
 * It only builds plain objects. loadSeed() (loadSeed.js) puts them in the
 * throw-away test database.
 *
 * What is in it, and why:
 *
 *  People     one of each kind who gets a different answer from the API:
 *             an admin, a reviewer, two counsellors, a member of staff with no
 *             special rights, a member of staff who has left, two sub-agents
 *             and two school counsellors. Two of each partner, so that "sees
 *             only their own" has someone else's records to leave out.
 *  Courses    two, at two universities and two levels. Each has a place in
 *             the country the Courses pages ask for and a page of its own
 *             (its intakes, campuses and university), so a screen can list
 *             them and an application can be made from them.
 *  Students   every stage, for each kind of owner.
 *  Applications  one at each of the eight phases, and one in each review state.
 *  Documents  one in each state.
 *  Fees       each type, on both sides of the turn of a month.
 *  Leads      each status, with and without someone assigned.
 *  WhatsApp   conversations with and without someone assigned, open and closed.
 *
 * Everything is made up by construction; see tests/factories/index.js.
 */

const STAGES = ['NotApplied', 'Applied', 'Lost', 'Enrolled', 'PendingReview', 'Denied'];
const REVIEW_STATES = [
  'DRAFT',
  'SUBMITTED_BY_SUBAGENT',
  'SUBMITTED_BY_COUNSELOR',
  'APPROVED',
  'REJECTED',
  'RETURNED_FOR_EDIT',
];
const DOC_STATES = ['Upload', 'Not Uploaded', 'Requested', 'Received', 'Verified', 'Rejected'];

const buildSeed = () => {
  factories.reset();

  // ---- roles ---------------------------------------------------------------
  // The four the other fixtures already use, so a seeded user and a fixture
  // user of the same kind hold the same role, and two more for the two rights
  // a member of staff can be given.
  const reviewerRole = build.role({ name: 'Reviewer', roleRights: [roleAccess.REVIEWER_RIGHT] });
  const counsellorRole = build.role({ name: 'Senior Counsellor', roleRights: [roleAccess.COUNSELOR_TOOLS_RIGHT] });
  const roles = {
    admin: adminRole,
    staff: userRole,
    reviewer: reviewerRole,
    counsellor: counsellorRole,
    subAgent: subAgentRole,
    schoolCounselor: schoolCounselorRole,
  };

  // ---- people --------------------------------------------------------------
  const users = {
    admin: build.user({ role: roles.admin._id }),
    reviewer: build.user({ role: roles.reviewer._id }),
    counsellorA: build.user({ role: roles.counsellor._id }),
    counsellorB: build.user({ role: roles.counsellor._id }),
    staff: build.user({ role: roles.staff._id }),
    formerStaff: build.user({ role: roles.staff._id, former: true, formerAt: daysBefore(90) }),
    subAgentA: build.user({ role: roles.subAgent._id, organisation: 'Seed Agency A' }),
    subAgentB: build.user({ role: roles.subAgent._id, organisation: 'Seed Agency B' }),
    schoolA: build.user({ role: roles.schoolCounselor._id, organisation: 'Seed School A' }),
    schoolB: build.user({ role: roles.schoolCounselor._id, organisation: 'Seed School B' }),
  };

  const assignedTo = (aUser, slot = 'counsellor') => [{ user: aUser._id, role: slot, userRole: aUser.role }];

  // ---- catalogue -----------------------------------------------------------
  const universities = [build.university(), build.university()];
  const courses = [
    build.course({ institution: universities[0].name, institutionSlug: universities[0].slug }),
    build.course({ institution: universities[1].name, institutionSlug: universities[1].slug, courseLevel: 'Postgraduate' }),
  ];
  // What each course's own page says. An application is made from this.
  const courseDetails = courses.map((aCourse, index) =>
    build.courseDetail({
      courseRefId: aCourse.courseRefId,
      name: aCourse.name,
      slug: aCourse.slug,
      courseLevel: aCourse.courseLevel,
      approxAnnualFee: aCourse.approxAnnualFee,
      // eslint-disable-next-line security/detect-object-injection
      institution: { name: universities[index].name, slug: universities[index].slug },
    })
  );

  // ---- students ------------------------------------------------------------
  const students = [];
  const add = (overrides) => {
    const made = build.student(overrides);
    students.push(made);
    return made;
  };

  // Staff students: every stage a member of staff's student can be in, for each
  // of the two counsellors.
  [users.counsellorA, users.counsellorB].forEach((counsellor) => {
    ['NotApplied', 'Applied', 'Lost', 'Enrolled'].forEach((stage) => {
      add({ stage, createdBy: counsellor._id, assignedTo: assignedTo(counsellor), channel: 'direct', source: 'uapply' });
    });
  });

  // A sub-agent's students. A partner is never written into assignedTo: what
  // makes a student theirs is createdBy. Once staff accept the student, a
  // counsellor is assigned as well.
  [users.subAgentA, users.subAgentB].forEach((agent, index) => {
    const counsellor = index === 0 ? users.counsellorA : users.counsellorB;
    const theirs = { createdBy: agent._id, channel: 'subagent', source: 'ulearn' };
    add({ ...theirs, stage: 'PendingReview' });
    add({
      ...theirs,
      stage: 'Denied',
      denialReason: 'Seed reason: the documents were incomplete.',
      reviewedAt: daysBefore(5),
    });
    add({ ...theirs, stage: 'NotApplied', assignedTo: assignedTo(counsellor), reviewedAt: daysBefore(20) });
    add({ ...theirs, stage: 'Applied', assignedTo: assignedTo(counsellor), reviewedAt: daysBefore(30) });
  });

  // A school counsellor's students.
  [users.schoolA, users.schoolB].forEach((school, index) => {
    const counsellor = index === 0 ? users.counsellorA : users.counsellorB;
    const theirs = { createdBy: school._id, channel: 'counselor', source: 'ulearn', previousSchool: school.organisation };
    add({ ...theirs, stage: 'PendingReview' });
    add({ ...theirs, stage: 'Applied', assignedTo: assignedTo(counsellor), reviewedAt: daysBefore(25) });
    add({ ...theirs, stage: 'Enrolled', assignedTo: assignedTo(counsellor), reviewedAt: daysBefore(45) });
  });

  // A student nobody is assigned to and no partner made: only staff can see it.
  add({ stage: 'NotApplied', channel: 'lead' });

  const ownedBy = (aUser) =>
    students.filter(
      (s) =>
        (s.createdBy && String(s.createdBy) === String(aUser._id)) ||
        s.assignedTo.some((a) => String(a.user) === String(aUser._id))
    );
  const inStage = (list, stage) => list.filter((s) => s.stage === stage);

  // ---- applications --------------------------------------------------------
  const applications = [];
  const apply = (aStudent, overrides) => {
    const which = applications.length % courses.length;
    const made = build.application({
      studentId: aStudent._id,
      // eslint-disable-next-line security/detect-object-injection
      course: courses[which]._id,
      // eslint-disable-next-line security/detect-object-injection
      institute: { name: universities[which].name },
      ...overrides,
    });
    applications.push(made);
    aStudent.applications.push(String(made._id));
    return made;
  };

  // One application at each of the eight phases, spread over the staff students
  // who have applied or enrolled.
  const staffApplicants = students.filter((s) => ['Applied', 'Enrolled'].includes(s.stage) && s.channel === 'direct');
  PHASES.forEach((phase, index) => {
    const aStudent = staffApplicants[index % staffApplicants.length];
    apply(aStudent, { phase, createdBy: aStudent.createdBy, createdByRole: roles.counsellor._id });
  });

  // One application in each review state, on the partners' students.
  const subAgentApplicant = inStage(ownedBy(users.subAgentA), 'Applied')[0];
  const otherSubAgentApplicant = inStage(ownedBy(users.subAgentB), 'Applied')[0];
  const schoolApplicant = inStage(ownedBy(users.schoolA), 'Applied')[0];
  const otherSchoolApplicant = inStage(ownedBy(users.schoolB), 'Applied')[0];
  const submitted = (by, at) => [{ action: 'SUBMITTED', by: by._id, byName: by.name, at }];
  const fromSubAgent = { createdBy: users.subAgentA._id, createdByRole: roles.subAgent._id };
  const fromSchool = { createdBy: users.schoolA._id, createdByRole: roles.schoolCounselor._id };

  apply(subAgentApplicant, { ...fromSubAgent, reviewStatus: 'DRAFT' });
  apply(subAgentApplicant, {
    ...fromSubAgent,
    reviewStatus: 'SUBMITTED_BY_SUBAGENT',
    reviewHistory: submitted(users.subAgentA, daysBefore(4)),
  });
  apply(subAgentApplicant, {
    ...fromSubAgent,
    reviewStatus: 'RETURNED_FOR_EDIT',
    reviewHistory: [
      ...submitted(users.subAgentA, daysBefore(9)),
      {
        action: 'RETURNED_FOR_EDIT',
        by: users.reviewer._id,
        byName: users.reviewer.name,
        note: 'Seed note: please add the transcript.',
        at: daysBefore(8),
      },
    ],
  });
  apply(subAgentApplicant, {
    ...fromSubAgent,
    reviewStatus: 'REJECTED',
    rejected: true,
    reviewHistory: [
      ...submitted(users.subAgentA, daysBefore(12)),
      {
        action: 'REJECTED',
        by: users.reviewer._id,
        byName: users.reviewer.name,
        note: 'Seed note: not eligible.',
        at: daysBefore(11),
      },
    ],
  });
  apply(otherSubAgentApplicant, {
    createdBy: users.subAgentB._id,
    createdByRole: roles.subAgent._id,
    reviewStatus: 'APPROVED',
    phase: 'Submitted',
    reviewHistory: [
      ...submitted(users.subAgentB, daysBefore(15)),
      { action: 'APPROVED', by: users.reviewer._id, byName: users.reviewer.name, at: daysBefore(14) },
    ],
  });
  apply(schoolApplicant, {
    ...fromSchool,
    reviewStatus: 'SUBMITTED_BY_COUNSELOR',
    reviewHistory: submitted(users.schoolA, daysBefore(3)),
  });
  apply(otherSchoolApplicant, {
    createdBy: users.schoolB._id,
    createdByRole: roles.schoolCounselor._id,
    reviewStatus: 'APPROVED',
    phase: 'Conditional offer',
    reviewHistory: [
      ...submitted(users.schoolB, daysBefore(18)),
      { action: 'APPROVED', by: users.reviewer._id, byName: users.reviewer.name, at: daysBefore(17) },
    ],
  });

  // ---- documents, comments, notes ------------------------------------------
  // On one student of each kind of owner, so that "whose student is this"
  // decides who may read them.
  const documented = [
    inStage(ownedBy(users.counsellorA), 'Applied')[0],
    subAgentApplicant,
    otherSubAgentApplicant,
    schoolApplicant,
    otherSchoolApplicant,
  ];
  const documents = [];
  DOC_STATES.forEach((docState, index) => {
    documents.push(build.document({ docState, studentId: documented[index % documented.length]._id }));
  });
  // Every documented student has at least a passport record.
  documented.forEach((aStudent) => {
    documents.push(build.document({ documentType: 'Passport', docState: 'Verified', studentId: aStudent._id }));
  });

  const comments = [];
  const notes = [];
  documented.forEach((aStudent) => {
    comments.push(build.comment({ studentId: aStudent._id, author: users.counsellorA }));
    notes.push(build.note({ student: aStudent._id, author: users.counsellorA }));
  });
  comments.push(build.comment({ studentId: subAgentApplicant._id, author: users.subAgentA }));
  // Staff reach a sub-agent by tagging them; an untagged staff comment is the team's own.
  comments.push(
    build.comment({ studentId: subAgentApplicant._id, author: users.counsellorA, taggedUsers: [users.subAgentA._id] })
  );
  comments.push(build.comment({ studentId: schoolApplicant._id, author: users.schoolA }));
  notes.push(build.note({ student: documented[0]._id, author: users.reviewer, pinned: true }));

  // ---- fees ----------------------------------------------------------------
  // Each type twice: once on the last day of December 2025 and once on the
  // first day of January 2026, so a monthly total has a known edge to get right.
  const lastOfDecember = new Date('2025-12-31T12:00:00.000Z');
  const firstOfJanuary = new Date('2026-01-01T12:00:00.000Z');
  const payer = inStage(ownedBy(users.counsellorA), 'Enrolled')[0];
  const fees = [];
  FEE_TYPES.forEach((feeType) => {
    fees.push(
      build.fee({
        feeType,
        createdDate: lastOfDecember,
        createdAt: lastOfDecember,
        updatedAt: lastOfDecember,
        student: payer._id,
      })
    );
    fees.push(
      build.fee({
        feeType,
        createdDate: firstOfJanuary,
        createdAt: firstOfJanuary,
        updatedAt: firstOfJanuary,
        student: payer._id,
      })
    );
  });

  // ---- leads ---------------------------------------------------------------
  const leads = [];
  LEAD_STATUSES.forEach((status) => {
    leads.push(build.lead({ status }));
    leads.push(build.lead({ status, assignedTo: users.staff._id, assignedAt: daysBefore(6) }));
  });
  // The assigned "Converted" lead became the student nobody else owns.
  const converted = leads.find((l) => l.status === 'Converted' && l.assignedTo);
  const unowned = students.find((s) => s.channel === 'lead');
  converted.convertedStudentId = unowned._id;
  converted.convertedAt = daysBefore(2);

  // ---- WhatsApp ------------------------------------------------------------
  const conversations = [
    build.conversation({ status: 'open' }),
    build.conversation({
      status: 'open',
      assignees: [{ userId: users.counsellorA._id, role: 'counsellor' }],
      unreadCount: 2,
    }),
    build.conversation({
      status: 'waiting',
      assignees: [{ userId: users.counsellorB._id, role: 'counsellor' }],
      student: inStage(ownedBy(users.counsellorB), 'Applied')[0]._id,
    }),
    build.conversation({
      status: 'resolved',
      resolvedAt: daysBefore(1),
      assignees: [{ userId: users.counsellorA._id, role: 'counsellor' }],
    }),
  ];
  const messages = [];
  conversations.forEach((aConversation, index) => {
    const at = aConversation.lastMessageAt;
    messages.push(
      build.message({
        conversation: aConversation._id,
        direction: 'inbound',
        timestamp: new Date(at.getTime() - 2 * 60 * 1000),
      })
    );
    if (aConversation.assignees.length) {
      messages.push(
        build.message({
          conversation: aConversation._id,
          direction: 'outbound',
          status: 'read',
          sentByUser: aConversation.assignees[0].userId,
          timestamp: new Date(at.getTime() - 60 * 1000),
        })
      );
    }
    if (index === 1) {
      messages.push(
        build.message({
          conversation: aConversation._id,
          direction: 'outbound',
          internal: true,
          type: 'system',
          waMessageId: undefined,
          timestamp: at,
        })
      );
    }
  });

  return {
    now: SEED_NOW,
    roles,
    users,
    universities,
    courses,
    courseDetails,
    students,
    applications,
    documents,
    comments,
    notes,
    fees,
    leads,
    conversations,
    messages,
    // Questions a test will want to ask of the seed.
    studentsOwnedBy: ownedBy,
    studentsInStage: (stage) => inStage(students, stage),
    applicationsOf: (aStudent) => applications.filter((a) => String(a.studentId) === String(aStudent._id)),
  };
};

module.exports = { buildSeed, STAGES, REVIEW_STATES, DOC_STATES, DAY };
