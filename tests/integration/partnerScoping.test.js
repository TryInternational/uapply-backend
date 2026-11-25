const request = require('supertest');
const httpStatus = require('http-status');
const app = require('../../src/app');
const setupTestDB = require('../utils/setupTestDB');
const { loadSeed } = require('../seed/loadSeed');
const { accessTokenFor } = require('../fixtures/token.fixture');

setupTestDB();

/**
 * Does an outside partner see only their own records?
 *
 * The route matrix (routeAccess.test.js) shows who gets past the gates. It
 * cannot show this, because it asks for records that do not exist. These tests
 * ask for records that do: the seed has two sub-agents and two school
 * counsellors, each with students of their own, so "their own" always has
 * somebody else's next to it.
 */

const idsOf = (list) => list.map((record) => String(record.id || record._id)).sort();
// Some list routes answer with a page ({ results }) and some with a plain list.
const listIn = (body) => (Array.isArray(body) ? body : body.results || []);

describe('what a partner can see', () => {
  let seed;
  let u;
  const get = (user, path) =>
    request(app)
      .get(path)
      .set('Authorization', `Bearer ${accessTokenFor(user)}`);

  beforeEach(async () => {
    seed = await loadSeed();
    u = seed.users;
  });

  // A student of each owner who has got as far as applying, so each one has
  // documents, comments, a note and applications.
  const applicantOf = (owner) =>
    seed.studentsOwnedBy(owner).find((s) => s.stage === 'Applied' && String(s.createdBy) === String(owner._id));

  describe.each([
    ['sub-agent', 'subAgentA', 'subAgentB', 4],
    ['school counsellor', 'schoolA', 'schoolB', 3],
  ])('a %s', (kind, mine, theirs, howMany) => {
    test("lists their own students and nobody else's", async () => {
      const res = await get(u[mine], '/v1/students?limit=100').expect(httpStatus.OK);

      expect(res.body.totalResults).toBe(howMany);
      expect(idsOf(res.body.results)).toEqual(idsOf(seed.studentsOwnedBy(u[mine])));
    });

    test('reads one of their own students', async () => {
      const own = applicantOf(u[mine]);

      const res = await get(u[mine], `/v1/students/${own._id}`).expect(httpStatus.OK);

      expect(res.body.firstName).toBe(own.firstName);
    });

    test.each([
      ['the other partner of the same kind', () => applicantOf(u[theirs])],
      ['a partner of the other kind', () => applicantOf(kind === 'sub-agent' ? u.schoolA : u.subAgentA)],
      ['staff', () => seed.studentsOwnedBy(u.counsellorA).find((s) => s.channel === 'direct')],
      ['nobody', () => seed.students.find((s) => s.channel === 'lead')],
    ])('is told a student of %s does not exist', async (whose, find) => {
      await get(u[mine], `/v1/students/${find()._id}`).expect(httpStatus.NOT_FOUND);
    });

    test('reads the documents, notes and applications of their own student', async () => {
      const own = applicantOf(u[mine]);

      const documents = await get(u[mine], `/v1/documents/student/${own._id}`).expect(httpStatus.OK);
      const notes = await get(u[mine], `/v1/notes?studentId=${own._id}`).expect(httpStatus.OK);
      const applications = await get(u[mine], `/v1/application/student/${own._id}`).expect(httpStatus.OK);

      expect(listIn(documents.body)).toHaveLength(
        seed.documents.filter((d) => String(d.studentId) === String(own._id)).length
      );
      expect(listIn(notes.body)).toHaveLength(seed.notes.filter((n) => String(n.student) === String(own._id)).length);
      expect(listIn(applications.body)).toHaveLength(seed.applicationsOf(own).length);
    });

    test("is refused the documents, comments, notes and applications of somebody else's student", async () => {
      const other = applicantOf(u[theirs]);

      await get(u[mine], `/v1/documents/student/${other._id}`).expect(httpStatus.NOT_FOUND);
      await get(u[mine], `/v1/comments/student/${other._id}`).expect(httpStatus.NOT_FOUND);
      await get(u[mine], `/v1/notes?studentId=${other._id}`).expect(httpStatus.NOT_FOUND);
      await get(u[mine], `/v1/application/student/${other._id}`).expect(httpStatus.NOT_FOUND);
    });

    test('is refused a list of documents or notes that names no student', async () => {
      await get(u[mine], '/v1/documents').expect(httpStatus.FORBIDDEN);
      await get(u[mine], '/v1/notes').expect(httpStatus.FORBIDDEN);
    });
  });

  describe('staff', () => {
    test('see every student, whoever made it', async () => {
      const res = await get(u.staff, '/v1/students?limit=100').expect(httpStatus.OK);

      expect(res.body.totalResults).toBe(seed.students.length);
    });

    test("read a partner's student and what hangs off it", async () => {
      const partners = applicantOf(u.subAgentA);

      await get(u.counsellorB, `/v1/students/${partners._id}`).expect(httpStatus.OK);
      await get(u.counsellorB, `/v1/documents/student/${partners._id}`).expect(httpStatus.OK);
      await get(u.counsellorB, `/v1/application/student/${partners._id}`).expect(httpStatus.OK);
    });
  });

  describe('applications', () => {
    const studentOf = (application) => seed.students.find((s) => String(s._id) === String(application.studentId));
    const applicationsOfStudentsOf = (owner) => {
      const theirs = idsOf(seed.studentsOwnedBy(owner));
      return seed.applications.filter((a) => theirs.includes(String(a.studentId)));
    };

    test("a sub-agent's own list holds their applications and nobody else's", async () => {
      const res = await get(u.subAgentA, '/v1/application/mine').expect(httpStatus.OK);

      expect(idsOf(listIn(res.body))).toEqual(idsOf(applicationsOfStudentsOf(u.subAgentA)));
    });

    test("a school counsellor's own list holds their applications and nobody else's", async () => {
      const res = await get(u.schoolA, '/v1/application/mine-school').expect(httpStatus.OK);

      expect(idsOf(listIn(res.body))).toEqual(idsOf(applicationsOfStudentsOf(u.schoolA)));
    });

    test('a sub-agent asking for the whole list gets only their own', async () => {
      const res = await get(u.subAgentA, '/v1/application').expect(httpStatus.OK);

      expect(idsOf(listIn(res.body))).toEqual(idsOf(applicationsOfStudentsOf(u.subAgentA)));
    });

    test("a sub-agent is told somebody else's application does not exist", async () => {
      const staffs = seed.applications.find((a) => studentOf(a).channel === 'direct');
      const otherAgents = applicationsOfStudentsOf(u.subAgentB)[0];

      await get(u.subAgentA, `/v1/application/${staffs._id}`).expect(httpStatus.NOT_FOUND);
      await get(u.subAgentA, `/v1/application/${otherAgents._id}`).expect(httpStatus.NOT_FOUND);
    });

    test('a school counsellor is not shown which member of staff reviewed an application', async () => {
      const res = await get(u.schoolB, '/v1/application/mine-school').expect(httpStatus.OK);

      const reviewed = listIn(res.body).filter((a) => (a.reviewHistory || []).some((entry) => entry.action !== 'SUBMITTED'));
      expect(reviewed.length).toBeGreaterThan(0);
      expect(JSON.stringify(reviewed)).not.toContain(u.reviewer.name);
      expect(JSON.stringify(reviewed)).not.toContain(String(u.reviewer._id));
    });

    // How things are today, not how they are meant to be. Each rule below was
    // written for one kind of partner and not the other. Whether to close each
    // one is the owner's decision; when one is closed, its test fails and is
    // rewritten to say what is then true.
    describe('not the same for both kinds of partner yet', () => {
      test("a school counsellor asking for the whole list is given other people's applications", async () => {
        const res = await get(u.schoolA, '/v1/application').expect(httpStatus.OK);

        const own = idsOf(applicationsOfStudentsOf(u.schoolA));
        const given = idsOf(listIn(res.body));
        expect(given.filter((id) => !own.includes(id)).length).toBeGreaterThan(0);
      });

      test('a school counsellor can read an application of staff, and of a sub-agent, by its id', async () => {
        const staffs = seed.applications.find((a) => studentOf(a).channel === 'direct');
        const agents = applicationsOfStudentsOf(u.subAgentB)[0];

        await get(u.schoolA, `/v1/application/${staffs._id}`).expect(httpStatus.OK);
        await get(u.schoolA, `/v1/application/${agents._id}`).expect(httpStatus.OK);
      });

      test('a sub-agent is shown which member of staff reviewed their application', async () => {
        const res = await get(u.subAgentA, '/v1/application/mine').expect(httpStatus.OK);

        const reviewed = listIn(res.body).filter((a) =>
          (a.reviewHistory || []).some((entry) => entry.action !== 'SUBMITTED')
        );
        expect(reviewed.length).toBeGreaterThan(0);
        expect(JSON.stringify(reviewed)).toContain(u.reviewer.name);
      });
    });
  });

  describe('comments on a student', () => {
    const commentsOn = (aStudent) => seed.comments.filter((c) => String(c.studentId) === String(aStudent._id));

    test('a sub-agent sees what they wrote and what tags them, and not the rest of the thread', async () => {
      const own = applicantOf(u.subAgentA);
      const me = String(u.subAgentA._id);
      const wroteOrTagged = commentsOn(own).filter(
        (c) => String(c.userId) === me || (c.taggedUsers || []).map(String).includes(me)
      );
      // The thread has a comment of each sort: theirs, one that tags them, and one that is the team's own.
      expect(commentsOn(own)).toHaveLength(3);
      expect(wroteOrTagged).toHaveLength(2);

      const res = await get(u.subAgentA, `/v1/comments/student/${own._id}`).expect(httpStatus.OK);

      expect(idsOf(listIn(res.body))).toEqual(idsOf(wroteOrTagged));
    });

    test('staff see the whole thread', async () => {
      const own = applicantOf(u.subAgentA);

      const res = await get(u.counsellorB, `/v1/comments/student/${own._id}`).expect(httpStatus.OK);

      expect(idsOf(listIn(res.body))).toEqual(idsOf(commentsOn(own)));
    });

    // How things are today: the rule above is written for sub-agents only.
    test("not the same for both kinds of partner yet: a school counsellor sees the whole thread, the team's own comments included", async () => {
      const own = applicantOf(u.schoolA);
      const teamsOwn = commentsOn(own).filter(
        (c) => String(c.userId) === String(u.counsellorA._id) && !(c.taggedUsers || []).length
      );
      expect(teamsOwn).toHaveLength(1);

      const res = await get(u.schoolA, `/v1/comments/student/${own._id}`).expect(httpStatus.OK);

      expect(idsOf(listIn(res.body))).toEqual(idsOf(commentsOn(own)));
    });
  });
});
