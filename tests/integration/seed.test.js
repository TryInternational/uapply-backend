const mongoose = require('mongoose');
const setupTestDB = require('../utils/setupTestDB');
const models = require('../../src/models');
const roleAccess = require('../../src/services/roleAccess.service');
const { isSeedId } = require('../factories/seedIds');
const { PHASES, FEE_TYPES, LEAD_STATUSES, SEED_NOW } = require('../factories');
const { buildSeed, STAGES, REVIEW_STATES, DOC_STATES } = require('../seed/buildSeed');
const { loadSeed, countsOf } = require('../seed/loadSeed');

setupTestDB();

// Every plain value in a record, however deeply nested, with ids and dates as they are.
const leaves = (value, found = []) => {
  if (value instanceof Date || value instanceof mongoose.Types.ObjectId) found.push(value);
  else if (Array.isArray(value)) value.forEach((item) => leaves(item, found));
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => leaves(item, found));
  else found.push(value);
  return found;
};

const everyRecord = (seed) => [
  ...Object.values(seed.users),
  ...seed.universities,
  ...seed.courses,
  ...seed.students,
  ...seed.applications,
  ...seed.documents,
  ...seed.comments,
  ...seed.notes,
  ...seed.fees,
  ...seed.leads,
  ...seed.conversations,
  ...seed.messages,
];

describe('the seed', () => {
  describe('as built', () => {
    test('is the same every time', () => {
      expect(JSON.stringify(buildSeed())).toBe(JSON.stringify(buildSeed()));
    });

    test('holds what the tests count on', () => {
      expect(countsOf(buildSeed())).toEqual({
        roles: 6,
        users: 10,
        universities: 2,
        courses: 2,
        students: 23,
        applications: 15,
        documents: 11,
        comments: 8,
        notes: 6,
        fees: 8,
        leads: 8,
        conversations: 4,
        messages: 8,
      });
    });

    test('every record it makes carries the mark of made-up data', () => {
      everyRecord(buildSeed()).forEach((record) => expect(isSeedId(record._id)).toBe(true));
    });

    test('no two records share an id', () => {
      const ids = everyRecord(buildSeed()).map((record) => String(record._id));
      expect(new Set(ids).size).toBe(ids.length);
    });

    test('nothing in it is dated after the moment the seed calls now', () => {
      const dates = leaves(everyRecord(buildSeed())).filter((value) => value instanceof Date);
      expect(dates.length).toBeGreaterThan(100);
      dates.forEach((date) => expect(date.getTime()).toBeLessThanOrEqual(SEED_NOW.getTime()));
    });

    test('every e-mail address is at example.com and every phone number cannot exist', () => {
      const strings = leaves(everyRecord(buildSeed())).filter((value) => typeof value === 'string');
      const emails = strings.filter((value) => value.includes('@'));
      const phones = strings.filter((value) => value.startsWith('+'));
      expect(emails.length).toBeGreaterThan(30);
      expect(phones.length).toBeGreaterThan(30);
      emails.forEach((value) => expect(value).toMatch(/@example\.com$/));
      phones.forEach((value) => expect(value).toMatch(/^\+9650\d{7}$/));
    });

    test('every id that points at another record points at one that is in the seed', () => {
      const seed = buildSeed();
      const known = new Set([
        ...everyRecord(seed).map((record) => String(record._id)),
        ...Object.values(seed.roles).map((role) => String(role._id)),
      ]);
      const pointers = leaves(everyRecord(seed)).filter((value) => value instanceof mongoose.Types.ObjectId);
      expect(pointers.length).toBeGreaterThan(150);
      pointers.forEach((id) => expect(known.has(String(id))).toBe(true));
      // A student lists its applications as strings.
      seed.students.forEach((student) => student.applications.forEach((id) => expect(known.has(id)).toBe(true)));
    });
  });

  describe('what it covers', () => {
    const seed = buildSeed();

    test('a user of every kind the gates tell apart', () => {
      const u = seed.users;
      expect(roleAccess.ADMIN_RIGHT).toBeDefined();
      expect(String(u.subAgentA.role)).toBe(process.env.SUB_AGENT_ROLE_ID);
      expect(String(u.schoolA.role)).toBe(process.env.SCHOOL_COUNSELOR_ROLE_ID);
      expect(seed.roles.admin.roleRights).toEqual([roleAccess.ADMIN_RIGHT]);
      expect(seed.roles.reviewer.roleRights).toEqual([roleAccess.REVIEWER_RIGHT]);
      expect(seed.roles.counsellor.roleRights).toEqual([roleAccess.COUNSELOR_TOOLS_RIGHT]);
      expect(u.formerStaff.former).toBe(true);
      // Every user has a role: a user with none cannot sign in.
      Object.values(u).forEach((user) => expect(user.role).toBeDefined());
    });

    test('students in every stage', () => {
      expect([...new Set(seed.students.map((s) => s.stage))].sort()).toEqual([...STAGES].sort());
    });

    test('students on both sides of every ownership line', () => {
      const u = seed.users;
      expect(seed.studentsOwnedBy(u.subAgentA)).toHaveLength(4);
      expect(seed.studentsOwnedBy(u.subAgentB)).toHaveLength(4);
      expect(seed.studentsOwnedBy(u.schoolA)).toHaveLength(3);
      expect(seed.studentsOwnedBy(u.schoolB)).toHaveLength(3);
      // Each counsellor has four of their own and the partners' students they were given.
      expect(seed.studentsOwnedBy(u.counsellorA)).toHaveLength(8);
      expect(seed.studentsOwnedBy(u.counsellorB)).toHaveLength(8);
      // A partner is never written into assignedTo.
      const partners = [u.subAgentA, u.subAgentB, u.schoolA, u.schoolB].map((p) => String(p._id));
      seed.students.forEach((s) => s.assignedTo.forEach((a) => expect(partners).not.toContain(String(a.user))));
      // And one student belongs to nobody.
      expect(seed.students.filter((s) => !s.createdBy && !s.assignedTo.length)).toHaveLength(1);
    });

    test('an application at each of the eight phases', () => {
      const current = seed.applications.map(
        (a) => a.portalApplicationStatus.applicationPhases.find((p) => p.isCurrent).status
      );
      PHASES.forEach((phase) => expect(current).toContain(phase));
    });

    test('an application in each review state', () => {
      expect([...new Set(seed.applications.map((a) => a.reviewStatus))].sort()).toEqual([...REVIEW_STATES].sort());
    });

    test('a document in each state', () => {
      expect([...new Set(seed.documents.map((d) => d.docState))].sort()).toEqual([...DOC_STATES].sort());
    });

    test('a fee of each type on each side of the turn of the year', () => {
      FEE_TYPES.forEach((feeType) => {
        const ofType = seed.fees.filter((f) => f.feeType === feeType);
        expect(ofType.map((f) => f.createdDate.toISOString().slice(0, 7)).sort()).toEqual(['2025-12', '2026-01']);
      });
    });

    test('a lead in each status, with and without someone assigned', () => {
      LEAD_STATUSES.forEach((status) => {
        const ofStatus = seed.leads.filter((l) => l.status === status);
        expect(ofStatus.filter((l) => l.assignedTo)).toHaveLength(1);
        expect(ofStatus.filter((l) => !l.assignedTo)).toHaveLength(1);
      });
    });

    test('WhatsApp conversations with and without someone assigned, open and closed', () => {
      expect(seed.conversations.filter((c) => !c.assignees.length)).toHaveLength(1);
      expect(seed.conversations.map((c) => c.status).sort()).toEqual(['open', 'open', 'resolved', 'waiting']);
      expect([...new Set(seed.messages.map((m) => m.direction))].sort()).toEqual(['inbound', 'outbound']);
    });
  });

  describe('once loaded', () => {
    let seed;
    let took;

    beforeEach(async () => {
      const started = Date.now();
      seed = await loadSeed();
      took = Date.now() - started;
    });

    test('every collection holds exactly what was built', async () => {
      const counts = countsOf(seed);
      expect(await models.Roles.countDocuments()).toBe(counts.roles);
      expect(await models.User.countDocuments()).toBe(counts.users);
      expect(await models.Universities.countDocuments()).toBe(counts.universities);
      expect(await models.Courses.countDocuments()).toBe(counts.courses);
      expect(await models.Students.countDocuments()).toBe(counts.students);
      expect(await models.Application.countDocuments()).toBe(counts.applications);
      expect(await models.Documents.countDocuments()).toBe(counts.documents);
      expect(await models.Comments.countDocuments()).toBe(counts.comments);
      expect(await models.Note.countDocuments()).toBe(counts.notes);
      expect(await models.Fees.countDocuments()).toBe(counts.fees);
      expect(await models.Leads.countDocuments()).toBe(counts.leads);
      expect(await models.WhatsappConversation.countDocuments()).toBe(counts.conversations);
      expect(await models.WhatsappMessage.countDocuments()).toBe(counts.messages);
    });

    test('nothing but made-up records is in the database', async () => {
      const collections = Object.values(mongoose.connection.collections);
      const perCollection = await Promise.all(
        collections.map(async (collection) =>
          (await collection.find({}, { projection: { _id: 1 } }).toArray()).map((doc) => doc._id)
        )
      );
      const fixtureRoles = Object.values(seed.roles).map((role) => String(role._id));
      const ids = perCollection.flat().map(String);
      expect(ids.length).toBeGreaterThan(100);
      ids.forEach((id) => expect(isSeedId(id) || fixtureRoles.includes(id)).toBe(true));
    });

    test("the dates are the seed's own, not the moment it was loaded", async () => {
      const built = seed.studentsInStage('Enrolled')[0];
      const inDb = await models.Students.findById(built._id).lean();
      expect(inDb.createdAt.toISOString()).toBe(built.createdAt.toISOString());
      expect(inDb.updatedAt.toISOString()).toBe(built.updatedAt.toISOString());
      expect(inDb.enrolledAt.toISOString()).toBe(built.enrolledAt.toISOString());
      const fee = await models.Fees.findById(seed.fees[0]._id).lean();
      expect(fee.createdAt.toISOString()).toBe('2025-12-31T12:00:00.000Z');
    });

    test('the role service knows the seeded people for what they are', () => {
      const u = seed.users;
      expect(roleAccess.isAdmin(u.admin)).toBe(true);
      expect(roleAccess.isReviewer(u.reviewer)).toBe(true);
      expect(roleAccess.isAdmin(u.reviewer)).toBe(false);
      expect(roleAccess.canUseCounselorTools(u.counsellorA)).toBe(true);
      expect(roleAccess.canUseCounselorTools(u.staff)).toBe(false);
      expect(roleAccess.isSubAgent(u.subAgentA)).toBe(true);
      expect(roleAccess.isSchoolCounselor(u.schoolB)).toBe(true);
    });

    test('a seeded user can sign in with the seeded password', async () => {
      const stored = await models.User.findById(seed.users.admin._id);
      expect(stored.password).not.toBe(seed.users.admin.password);
      expect(await stored.isPasswordMatch(seed.users.admin.password)).toBe(true);
    });

    test('it loads quickly enough to run before every test that needs it', () => {
      expect(took).toBeLessThan(5000);
    });
  });
});
