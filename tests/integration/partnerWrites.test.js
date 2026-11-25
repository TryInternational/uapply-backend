const request = require('supertest');
const httpStatus = require('http-status');
const app = require('../../src/app');
const setupTestDB = require('../utils/setupTestDB');
const { Students, Application, Comments, Documents, Note } = require('../../src/models');
const { loadSeed } = require('../seed/loadSeed');
const { accessTokenFor } = require('../fixtures/token.fixture');
const { blocked } = require('../utils/blockNetwork');

setupTestDB();

/**
 * What an outside partner can change, and how what they send in is reviewed.
 *
 * partnerScoping.test.js covers what a partner can read. This covers the other
 * half: a partner adds a student, staff accept or decline it, the partner
 * applies for a course, and a reviewer decides. At each step the partner must
 * not be able to do staff's part, or reach anybody else's records.
 */

describe('what a partner can change', () => {
  let seed;
  let u;
  const as = (user) => {
    const token = `Bearer ${accessTokenFor(user)}`;
    return {
      get: (path) => request(app).get(path).set('Authorization', token),
      post: (path, body = {}) => request(app).post(path).set('Authorization', token).send(body),
      patch: (path, body = {}) => request(app).patch(path).set('Authorization', token).send(body),
      delete: (path) => request(app).delete(path).set('Authorization', token),
    };
  };

  beforeEach(async () => {
    seed = await loadSeed();
    u = seed.users;
  });

  const theirs = (owner, stage) =>
    seed.studentsOwnedBy(owner).find((s) => s.stage === stage && String(s.createdBy) === String(owner._id));
  const inDb = (aStudent) => Students.findById(aStudent._id || aStudent.id).lean();
  const newStudent = (extra = {}) => ({
    firstName: 'Rana',
    lastName: 'Testwell',
    phoneNo: '+96509900001',
    email: 'new.student@example.com',
    ...extra,
  });
  const newApplication = (aStudent, extra = {}) => ({
    studentId: String(aStudent._id || aStudent.id),
    courseName: 'Seed Course for a test',
    courseLevel: 'Undergraduate',
    intakeMonth: 'September',
    intakeYear: 2026,
    institute: { name: 'Seed University 1' },
    ...extra,
  });

  describe.each([
    ['sub-agent', 'subAgentA', 'subAgentB', 'subagent'],
    ['school counsellor', 'schoolA', 'schoolB', 'counselor'],
  ])('a %s adding a student', (kind, mine, other, channel) => {
    test('the student goes to review, as theirs, whatever the request says', async () => {
      const res = await as(u[mine])
        .post(
          '/v1/students',
          newStudent({
            // None of these is the partner's to set.
            stage: 'Enrolled',
            channel: 'direct',
            source: 'uapply',
            qualified: true,
            createdBy: String(u[other]._id),
            assignedTo: [{ user: String(u.counsellorA._id), role: 'counsellor' }],
            denialReason: 'set by the partner',
          })
        )
        .expect(httpStatus.CREATED);

      const stored = await inDb(res.body);
      expect(stored).toMatchObject({
        firstName: 'Rana',
        stage: 'PendingReview',
        channel,
        source: 'ulearn',
        qualified: false,
      });
      expect(String(stored.createdBy)).toBe(String(u[mine]._id));
      expect(stored.assignedTo).toEqual([]);
      expect(stored.denialReason).toBeFalsy();
    });

    test("the new student is in their list and not in the other partner's", async () => {
      const res = await as(u[mine]).post('/v1/students', newStudent()).expect(httpStatus.CREATED);
      const id = String(res.body.id || res.body._id);

      const own = await as(u[mine]).get('/v1/students?limit=100').expect(httpStatus.OK);
      const others = await as(u[other]).get('/v1/students?limit=100').expect(httpStatus.OK);

      expect(own.body.results.map((s) => s.id)).toContain(id);
      expect(others.body.results.map((s) => s.id)).not.toContain(id);
    });
  });

  describe.each([
    ['sub-agent', 'subAgentA', 'subAgentB'],
    ['school counsellor', 'schoolA', 'schoolB'],
  ])('a %s changing a student', (kind, mine, other) => {
    test('changes the profile of their own student', async () => {
      const own = theirs(u[mine], 'PendingReview');

      await as(u[mine]).patch(`/v1/students/${own._id}`, { city: 'Seedville', cgpa: '3.4' }).expect(httpStatus.OK);

      expect(await inDb(own)).toMatchObject({ city: 'Seedville', cgpa: '3.4' });
    });

    test('cannot accept their own student, take one over, or assign staff to it', async () => {
      const own = theirs(u[mine], 'PendingReview');

      await as(u[mine])
        .patch(`/v1/students/${own._id}`, {
          stage: 'NotApplied',
          createdBy: String(u[other]._id),
          assignedTo: [{ user: String(u.counsellorA._id), role: 'counsellor' }],
          qualified: true,
          channel: 'direct',
          reviewedAt: '2026-01-01T00:00:00.000Z',
        })
        .expect(httpStatus.OK);

      const stored = await inDb(own);
      expect(stored).toMatchObject({ stage: 'PendingReview', qualified: false, channel: own.channel });
      expect(String(stored.createdBy)).toBe(String(u[mine]._id));
      expect(stored.assignedTo).toEqual([]);
      expect(stored.reviewedAt).toBeUndefined();
    });

    test("is told somebody else's student does not exist, and changes nothing", async () => {
      const notTheirs = theirs(u[other], 'PendingReview');

      await as(u[mine]).patch(`/v1/students/${notTheirs._id}`, { city: 'Seedville' }).expect(httpStatus.NOT_FOUND);

      expect((await inDb(notTheirs)).city).toBeUndefined();
    });

    test('cannot give a student an e-mail address another student has', async () => {
      const own = theirs(u[mine], 'PendingReview');
      const taken = theirs(u[other], 'PendingReview').email;

      await as(u[mine]).patch(`/v1/students/${own._id}`, { email: taken }).expect(httpStatus.BAD_REQUEST);

      expect((await inDb(own)).email).toBe(own.email);
    });

    test('cannot delete a student, even their own', async () => {
      const own = theirs(u[mine], 'PendingReview');

      await as(u[mine]).delete(`/v1/students/${own._id}`).expect(httpStatus.FORBIDDEN);

      expect(await inDb(own)).not.toBeNull();
    });
  });

  test('a school counsellor may record passport details, and a sub-agent may not', async () => {
    const schools = theirs(u.schoolA, 'PendingReview');
    const agents = theirs(u.subAgentA, 'PendingReview');
    const details = { placeOfBirth: 'Seedville', civilNumber: '000000000000' };

    await as(u.schoolA).patch(`/v1/students/${schools._id}`, details).expect(httpStatus.OK);
    await as(u.subAgentA).patch(`/v1/students/${agents._id}`, details).expect(httpStatus.OK);

    expect(await inDb(schools)).toMatchObject(details);
    expect((await inDb(agents)).placeOfBirth).toBeUndefined();
    expect((await inDb(agents)).civilNumber).toBeUndefined();
  });

  describe.each([
    ['sub-agent', 'subAgentA', 'subAgentB'],
    ['school counsellor', 'schoolA', 'schoolB'],
  ])('a %s taking back a student', (kind, mine, other) => {
    test('removes a student that is still waiting for review', async () => {
      const waiting = theirs(u[mine], 'PendingReview');

      await as(u[mine])
        .post(`/v1/students/${waiting._id}/partner-withdraw`, { reason: 'Seed reason: the family changed its mind.' })
        .expect(httpStatus.OK);

      expect(await inDb(waiting)).toMatchObject({
        stage: 'Lost',
        denialReason: 'Seed reason: the family changed its mind.',
        lostReason: 'Removed by partner',
      });
    });

    test('cannot remove a student staff have already taken on', async () => {
      const accepted = theirs(u[mine], 'Applied');

      await as(u[mine]).post(`/v1/students/${accepted._id}/partner-withdraw`).expect(httpStatus.CONFLICT);

      expect((await inDb(accepted)).stage).toBe('Applied');
    });

    test("cannot remove somebody else's student", async () => {
      const notTheirs = theirs(u[other], 'PendingReview');

      await as(u[mine]).post(`/v1/students/${notTheirs._id}/partner-withdraw`).expect(httpStatus.NOT_FOUND);

      expect((await inDb(notTheirs)).stage).toBe('PendingReview');
    });
  });

  describe('a student that was sent back', () => {
    test('a sub-agent sends it in again, and the reason it was sent back is cleared', async () => {
      const sentBack = theirs(u.subAgentA, 'Denied');
      expect(sentBack.denialReason).toBeTruthy();

      await as(u.subAgentA).post(`/v1/students/${sentBack._id}/partner-resubmit`).expect(httpStatus.OK);

      expect(await inDb(sentBack)).toMatchObject({ stage: 'PendingReview', denialReason: '' });
    });

    test('only a student that was sent back can be sent in again', async () => {
      const waiting = theirs(u.subAgentA, 'PendingReview');
      const accepted = theirs(u.subAgentA, 'Applied');

      await as(u.subAgentA).post(`/v1/students/${waiting._id}/partner-resubmit`).expect(httpStatus.CONFLICT);
      await as(u.subAgentA).post(`/v1/students/${accepted._id}/partner-resubmit`).expect(httpStatus.CONFLICT);

      expect((await inDb(accepted)).stage).toBe('Applied');
    });

    test("a partner cannot send in somebody else's", async () => {
      const notTheirs = theirs(u.subAgentB, 'Denied');

      await as(u.subAgentA).post(`/v1/students/${notTheirs._id}/partner-resubmit`).expect(httpStatus.NOT_FOUND);
      await as(u.schoolA).post(`/v1/students/${notTheirs._id}/partner-resubmit`).expect(httpStatus.NOT_FOUND);

      expect((await inDb(notTheirs)).stage).toBe('Denied');
    });

    test('taking back and sending in again are for partners, not staff', async () => {
      const sentBack = theirs(u.subAgentA, 'Denied');

      await as(u.reviewer).post(`/v1/students/${sentBack._id}/partner-resubmit`).expect(httpStatus.FORBIDDEN);
      await as(u.admin).post(`/v1/students/${sentBack._id}/partner-withdraw`).expect(httpStatus.FORBIDDEN);

      expect((await inDb(sentBack)).stage).toBe('Denied');
    });
  });

  describe('staff deciding on a student a partner sent in', () => {
    test('accepting it opens it for applications', async () => {
      const waiting = theirs(u.subAgentA, 'PendingReview');

      await as(u.reviewer).patch(`/v1/students/${waiting._id}`, { stage: 'NotApplied' }).expect(httpStatus.OK);

      expect((await inDb(waiting)).stage).toBe('NotApplied');
      const seenByPartner = await as(u.subAgentA).get(`/v1/students/${waiting._id}`).expect(httpStatus.OK);
      expect(seenByPartner.body.stage).toBe('NotApplied');
    });

    test('declining it records why, and the partner can read the reason', async () => {
      const waiting = theirs(u.schoolA, 'PendingReview');
      const why = 'Seed reason: the transcript is missing.';

      await as(u.reviewer)
        .patch(`/v1/students/${waiting._id}`, { stage: 'Denied', denialReason: why })
        .expect(httpStatus.OK);

      const seenByPartner = await as(u.schoolA).get(`/v1/students/${waiting._id}`).expect(httpStatus.OK);
      expect(seenByPartner.body).toMatchObject({ stage: 'Denied', denialReason: why });
    });
  });

  describe('a sub-agent applying for a course', () => {
    test('the application goes to review, as theirs, whatever the request says', async () => {
      const own = theirs(u.subAgentA, 'NotApplied');

      const res = await as(u.subAgentA)
        .post(
          '/v1/application',
          newApplication(own, {
            // None of these is the partner's to set.
            reviewStatus: 'APPROVED',
            reviewHistory: [{ action: 'APPROVED', byName: 'Somebody' }],
            createdBy: String(u.subAgentB._id),
            rejected: true,
            managedBy: 'the partner',
            agent: 'SIUK',
          })
        )
        .expect(httpStatus.CREATED);

      const stored = await Application.findById(res.body._id || res.body.id).lean();
      expect(stored.reviewStatus).toBe('SUBMITTED_BY_SUBAGENT');
      expect(String(stored.createdBy)).toBe(String(u.subAgentA._id));
      expect(stored.reviewHistory.map((entry) => entry.action)).toEqual(['SUBMITTED']);
      expect(String(stored.reviewHistory[0].by)).toBe(String(u.subAgentA._id));
      expect(stored.rejected).toBeUndefined();
      expect(stored.managedBy).toBeUndefined();
      expect(stored.agent).toBeUndefined();
      expect((await inDb(own)).applications.map(String)).toContain(String(stored._id));
    });

    test("they cannot apply for somebody else's student", async () => {
      const before = await Application.countDocuments();

      await as(u.subAgentA)
        .post('/v1/application', newApplication(theirs(u.subAgentB, 'NotApplied')))
        .expect(httpStatus.NOT_FOUND);
      await as(u.subAgentA)
        .post('/v1/application', newApplication(theirs(u.schoolA, 'Applied')))
        .expect(httpStatus.NOT_FOUND);

      expect(await Application.countDocuments()).toBe(before);
    });
  });

  describe('a school counsellor applying for a course', () => {
    test('the application goes to review as theirs', async () => {
      const own = theirs(u.schoolA, 'Applied');

      const res = await as(u.schoolA)
        .post('/v1/application', newApplication(own, { reviewStatus: 'APPROVED', createdBy: String(u.schoolB._id) }))
        .expect(httpStatus.CREATED);

      const stored = await Application.findById(res.body._id || res.body.id).lean();
      expect(stored.reviewStatus).toBe('SUBMITTED_BY_COUNSELOR');
      expect(String(stored.createdBy)).toBe(String(u.schoolA._id));
      expect(stored.reviewHistory.map((entry) => entry.action)).toEqual(['SUBMITTED']);
    });

    test('they cannot apply for a student staff have not accepted yet', async () => {
      const before = await Application.countDocuments();

      await as(u.schoolA)
        .post('/v1/application', newApplication(theirs(u.schoolA, 'PendingReview')))
        .expect(httpStatus.FORBIDDEN);

      expect(await Application.countDocuments()).toBe(before);
    });
  });

  describe.each([
    ['sub-agent', 'subAgentA'],
    ['school counsellor', 'schoolA'],
  ])('a %s and an application once it is in', (kind, mine) => {
    const anApplicationOf = (owner) => seed.applications.find((a) => String(a.createdBy) === String(owner._id));

    test('cannot change it or delete it by the staff routes', async () => {
      const own = anApplicationOf(u[mine]);

      await as(u[mine]).patch(`/v1/application/${own._id}`, { reviewStatus: 'APPROVED' }).expect(httpStatus.FORBIDDEN);
      await as(u[mine]).delete(`/v1/application/${own._id}`).expect(httpStatus.FORBIDDEN);

      expect((await Application.findById(own._id).lean()).reviewStatus).toBe(own.reviewStatus);
    });

    test('cannot decide on it', async () => {
      const own = anApplicationOf(u[mine]);

      await as(u[mine]).post(`/v1/application/${own._id}/review`, { decision: 'APPROVED' }).expect(httpStatus.FORBIDDEN);

      expect((await Application.findById(own._id).lean()).reviewStatus).toBe(own.reviewStatus);
    });
  });

  describe('a reviewer deciding on an application', () => {
    const waitingFrom = (state) => seed.applications.find((a) => a.reviewStatus === state);
    const stateOf = async (anApplication) => (await Application.findById(anApplication._id).lean()).reviewStatus;

    test('approves one, and the decision is recorded with who made it', async () => {
      const waiting = waitingFrom('SUBMITTED_BY_SUBAGENT');

      await as(u.reviewer).post(`/v1/application/${waiting._id}/review`, { decision: 'APPROVED' }).expect(httpStatus.OK);

      const stored = await Application.findById(waiting._id).lean();
      expect(stored.reviewStatus).toBe('APPROVED');
      const last = stored.reviewHistory[stored.reviewHistory.length - 1];
      expect(last.action).toBe('APPROVED');
      expect(String(last.by)).toBe(String(u.reviewer._id));
    });

    test.each(['REJECTED', 'RETURNED_FOR_EDIT'])('must say why when the decision is %s', async (decision) => {
      const waiting = waitingFrom('SUBMITTED_BY_SUBAGENT');

      await as(u.reviewer).post(`/v1/application/${waiting._id}/review`, { decision }).expect(httpStatus.BAD_REQUEST);
      expect(await stateOf(waiting)).toBe('SUBMITTED_BY_SUBAGENT');

      await as(u.reviewer)
        .post(`/v1/application/${waiting._id}/review`, { decision, note: 'Seed note: written for a test.' })
        .expect(httpStatus.OK);
      expect(await stateOf(waiting)).toBe(decision);
    });

    test('is refused a decision that is not one of the three', async () => {
      const waiting = waitingFrom('SUBMITTED_BY_SUBAGENT');

      await as(u.reviewer)
        .post(`/v1/application/${waiting._id}/review`, { decision: 'DRAFT' })
        .expect(httpStatus.BAD_REQUEST);

      expect(await stateOf(waiting)).toBe('SUBMITTED_BY_SUBAGENT');
    });

    test('cannot decide again on one that was already rejected', async () => {
      const rejected = waitingFrom('REJECTED');

      await as(u.reviewer)
        .post(`/v1/application/${rejected._id}/review`, { decision: 'APPROVED' })
        .expect(httpStatus.BAD_REQUEST);

      expect(await stateOf(rejected)).toBe('REJECTED');
    });

    test('a member of staff without the review right cannot decide', async () => {
      const waiting = waitingFrom('SUBMITTED_BY_SUBAGENT');

      await as(u.staff).post(`/v1/application/${waiting._id}/review`, { decision: 'APPROVED' }).expect(httpStatus.FORBIDDEN);
      await as(u.counsellorA)
        .post(`/v1/application/${waiting._id}/review`, { decision: 'APPROVED' })
        .expect(httpStatus.FORBIDDEN);

      expect(await stateOf(waiting)).toBe('SUBMITTED_BY_SUBAGENT');
    });

    test('an admin can decide', async () => {
      const waiting = waitingFrom('SUBMITTED_BY_COUNSELOR');

      await as(u.admin).post(`/v1/application/${waiting._id}/review`, { decision: 'APPROVED' }).expect(httpStatus.OK);

      expect(await stateOf(waiting)).toBe('APPROVED');
    });
  });

  describe('an application that was sent back for changes', () => {
    const sentBack = () => seed.applications.find((a) => a.reviewStatus === 'RETURNED_FOR_EDIT');

    test('the sub-agent changes it and sends it in again', async () => {
      const res = await as(u.subAgentA)
        .patch(`/v1/application/${sentBack()._id}/resubmit`, {
          intakeMonth: 'January',
          note: 'Seed note: transcript added.',
          reviewStatus: 'APPROVED',
        })
        .expect(httpStatus.OK);

      expect(res.body.reviewStatus).toBe('SUBMITTED_BY_SUBAGENT');
      const stored = await Application.findById(sentBack()._id).lean();
      expect(stored).toMatchObject({ reviewStatus: 'SUBMITTED_BY_SUBAGENT', intakeMonth: 'January' });
      expect(stored.reviewHistory[stored.reviewHistory.length - 1]).toMatchObject({
        action: 'RESUBMITTED',
        note: 'Seed note: transcript added.',
      });
    });

    test('one that was not sent back cannot be sent in again', async () => {
      const draft = seed.applications.find((a) => a.reviewStatus === 'DRAFT');
      const rejected = seed.applications.find((a) => a.reviewStatus === 'REJECTED');

      await as(u.subAgentA).patch(`/v1/application/${draft._id}/resubmit`, {}).expect(httpStatus.FORBIDDEN);
      await as(u.subAgentA).patch(`/v1/application/${rejected._id}/resubmit`, {}).expect(httpStatus.FORBIDDEN);
    });

    test('another sub-agent is told it does not exist', async () => {
      await as(u.subAgentB).patch(`/v1/application/${sentBack()._id}/resubmit`, {}).expect(httpStatus.NOT_FOUND);

      expect((await Application.findById(sentBack()._id).lean()).reviewStatus).toBe('RETURNED_FOR_EDIT');
    });
  });

  describe('from start to finish', () => {
    test('a sub-agent adds a student, staff accept it, the sub-agent applies, and a reviewer approves', async () => {
      const added = await as(u.subAgentB).post('/v1/students', newStudent()).expect(httpStatus.CREATED);
      const studentId = String(added.body.id || added.body._id);
      expect(added.body.stage).toBe('PendingReview');

      await as(u.reviewer).patch(`/v1/students/${studentId}`, { stage: 'NotApplied' }).expect(httpStatus.OK);

      const applied = await as(u.subAgentB)
        .post('/v1/application', newApplication({ _id: studentId }))
        .expect(httpStatus.CREATED);
      const applicationId = String(applied.body._id || applied.body.id);
      expect(applied.body.reviewStatus).toBe('SUBMITTED_BY_SUBAGENT');

      await as(u.reviewer).post(`/v1/application/${applicationId}/review`, { decision: 'APPROVED' }).expect(httpStatus.OK);

      const mine = await as(u.subAgentB).get('/v1/application/mine').expect(httpStatus.OK);
      const seen = mine.body.find((a) => String(a._id || a.id) === applicationId);
      expect(seen.reviewStatus).toBe('APPROVED');
    });

    test('a school counsellor adds a student, staff accept it, the counsellor applies, a reviewer approves, and the student moves to Applied', async () => {
      const added = await as(u.schoolB).post('/v1/students', newStudent()).expect(httpStatus.CREATED);
      const studentId = String(added.body.id || added.body._id);

      await as(u.reviewer).patch(`/v1/students/${studentId}`, { stage: 'NotApplied' }).expect(httpStatus.OK);

      const applied = await as(u.schoolB)
        .post('/v1/application', newApplication({ _id: studentId }))
        .expect(httpStatus.CREATED);
      const applicationId = String(applied.body._id || applied.body.id);
      expect(applied.body.reviewStatus).toBe('SUBMITTED_BY_COUNSELOR');
      expect((await inDb({ _id: studentId })).stage).toBe('NotApplied');

      await as(u.reviewer).post(`/v1/application/${applicationId}/review`, { decision: 'APPROVED' }).expect(httpStatus.OK);

      expect((await inDb({ _id: studentId })).stage).toBe('Applied');
    });
  });

  describe.each([
    ['sub-agent', 'subAgentA', 'subAgentB'],
    ['school counsellor', 'schoolA', 'schoolB'],
  ])("a %s and what hangs off somebody else's student", (kind, mine, other) => {
    const on = (list, key, aStudent) => list.find((record) => String(record[key]) === String(aStudent._id));

    test('cannot add a comment, a note or a document to it', async () => {
      const notTheirs = theirs(u[other], 'Applied');
      const before = [await Comments.countDocuments(), await Note.countDocuments(), await Documents.countDocuments()];

      await as(u[mine])
        .post('/v1/comments', { studentId: String(notTheirs._id), content: 'x', createdBy: 'x' })
        .expect(httpStatus.NOT_FOUND);
      await as(u[mine])
        .post('/v1/notes', { student: String(notTheirs._id), body: 'x' })
        .expect(httpStatus.NOT_FOUND);
      await as(u[mine])
        .post('/v1/documents', { studentId: String(notTheirs._id), documentType: 'Passport' })
        .expect(httpStatus.NOT_FOUND);

      expect([await Comments.countDocuments(), await Note.countDocuments(), await Documents.countDocuments()]).toEqual(
        before
      );
    });

    test('cannot read or delete one of its documents by id, even when naming a student of their own', async () => {
      const own = theirs(u[mine], 'Applied');
      const document = on(seed.documents, 'studentId', theirs(u[other], 'Applied'));

      await as(u[mine]).get(`/v1/documents/${document._id}?studentId=${own._id}`).expect(httpStatus.NOT_FOUND);
      await as(u[mine]).delete(`/v1/documents/${document._id}?studentId=${own._id}`).expect(httpStatus.NOT_FOUND);

      expect(await Documents.findById(document._id).lean()).not.toBeNull();
    });

    test("cannot change the state of a document, their own included: that is the team's verdict", async () => {
      const document = on(seed.documents, 'studentId', theirs(u[mine], 'Applied'));

      await as(u[mine]).patch(`/v1/documents/${document._id}`, { docState: 'Verified' }).expect(httpStatus.FORBIDDEN);

      expect((await Documents.findById(document._id).lean()).docState).toBe(document.docState);
    });

    // A request about one comment or note by its id is checked against the
    // student that comment or note belongs to. Naming another student in the
    // request, in the query or in the body, changes nothing.
    test.each([
      ['naming a student of their own in the query', (own) => `?studentId=${own._id}`],
      ['naming no student', () => ''],
    ])('cannot read, change or delete one of its comments by id, %s', async (how, query) => {
      const comment = on(seed.comments, 'studentId', theirs(u[other], 'Applied'));
      const q = query(theirs(u[mine], 'Applied'));

      await as(u[mine]).get(`/v1/comments/${comment._id}${q}`).expect(httpStatus.NOT_FOUND);
      await as(u[mine])
        .patch(`/v1/comments/${comment._id}${q}`, { content: 'changed by another partner' })
        .expect(httpStatus.NOT_FOUND);
      await as(u[mine])
        .post(`/v1/comments/${comment._id}/tag${q}`, { userId: String(u[mine]._id) })
        .expect(httpStatus.NOT_FOUND);
      await as(u[mine]).delete(`/v1/comments/${comment._id}${q}`).expect(httpStatus.NOT_FOUND);

      const stored = await Comments.findById(comment._id).lean();
      expect(stored.content).toBe(comment.content);
      expect(stored.taggedUsers || []).toEqual([]);
    });

    test.each([
      ['naming a student of their own in the query', (own) => `?studentId=${own._id}`],
      ['naming no student', () => ''],
    ])('cannot change or delete one of its notes by id, %s', async (how, query) => {
      const note = on(seed.notes, 'student', theirs(u[other], 'Applied'));
      const q = query(theirs(u[mine], 'Applied'));

      await as(u[mine])
        .patch(`/v1/notes/${note._id}${q}`, { body: 'changed by another partner' })
        .expect(httpStatus.NOT_FOUND);
      await as(u[mine]).delete(`/v1/notes/${note._id}${q}`).expect(httpStatus.NOT_FOUND);

      expect((await Note.findById(note._id).lean()).body).toBe(note.body);
    });

    test('cannot do so by naming a student of their own in the body either', async () => {
      const own = theirs(u[mine], 'Applied');
      const comment = on(seed.comments, 'studentId', theirs(u[other], 'Applied'));
      const note = on(seed.notes, 'student', theirs(u[other], 'Applied'));

      await as(u[mine])
        .patch(`/v1/comments/${comment._id}`, { studentId: String(own._id), content: 'changed by another partner' })
        .expect(httpStatus.NOT_FOUND);
      await as(u[mine])
        .patch(`/v1/notes/${note._id}`, {
          student: String(own._id),
          studentId: String(own._id),
          body: 'changed by another partner',
        })
        .expect(httpStatus.NOT_FOUND);

      expect((await Comments.findById(comment._id).lean()).content).toBe(comment.content);
      expect((await Note.findById(note._id).lean()).body).toBe(note.body);
    });

    test('cannot move a comment or a note from their own student onto it', async () => {
      const own = theirs(u[mine], 'Applied');
      const notTheirs = theirs(u[other], 'Applied');
      const comment = on(seed.comments, 'studentId', own);
      const note = on(seed.notes, 'student', own);

      await as(u[mine]).patch(`/v1/comments/${comment._id}`, { studentId: String(notTheirs._id), content: 'moved' });
      await as(u[mine]).patch(`/v1/notes/${note._id}`, {
        student: String(notTheirs._id),
        studentId: String(notTheirs._id),
        body: 'moved',
      });

      expect(String((await Comments.findById(comment._id).lean()).studentId)).toBe(String(own._id));
      expect(String((await Note.findById(note._id).lean()).student)).toBe(String(own._id));
    });

    test('is told a comment or note that does not exist does not exist', async () => {
      const own = theirs(u[mine], 'Applied');
      const nothing = '5eed00060000000000ffffff';

      await as(u[mine]).get(`/v1/comments/${nothing}?studentId=${own._id}`).expect(httpStatus.NOT_FOUND);
      await as(u[mine]).delete(`/v1/notes/${nothing}?studentId=${own._id}`).expect(httpStatus.NOT_FOUND);
    });
  });

  describe.each([
    ['sub-agent', 'subAgentA'],
    ['school counsellor', 'schoolA'],
  ])('a %s and what hangs off their own student', (kind, mine) => {
    const on = (list, key, aStudent) => list.find((record) => String(record[key]) === String(aStudent._id));

    test.each([
      ['naming the student', (own) => `?studentId=${own._id}`],
      ['naming no student', () => ''],
    ])('can read and change one of its comments by id, %s', async (how, query) => {
      const own = theirs(u[mine], 'Applied');
      const comment = seed.comments.find(
        (c) => String(c.studentId) === String(own._id) && String(c.userId) === String(u[mine]._id)
      );
      const q = query(own);

      const read = await as(u[mine]).get(`/v1/comments/${comment._id}${q}`).expect(httpStatus.OK);
      expect(read.body.content).toBe(comment.content);

      await as(u[mine])
        .patch(`/v1/comments/${comment._id}${q}`, { content: 'Seed comment, corrected.' })
        .expect(httpStatus.OK);
      expect((await Comments.findById(comment._id).lean()).content).toBe('Seed comment, corrected.');
    });

    test('can add a comment and a note to it, and change the note', async () => {
      const own = theirs(u[mine], 'Applied');

      await as(u[mine])
        .post('/v1/comments', {
          studentId: String(own._id),
          content: 'Seed comment, added in a test.',
          createdBy: u[mine].name,
          userId: String(u[mine]._id),
        })
        .expect(httpStatus.CREATED);
      const added = await as(u[mine])
        .post('/v1/notes', { student: String(own._id), body: 'Seed note, added in a test.' })
        .expect(httpStatus.CREATED);
      const noteId = added.body.id || added.body._id;

      await as(u[mine]).patch(`/v1/notes/${noteId}`, { body: 'Seed note, corrected.' }).expect(httpStatus.OK);

      expect((await Note.findById(noteId).lean()).body).toBe('Seed note, corrected.');
      expect(String((await Note.findById(noteId).lean()).student)).toBe(String(own._id));
      expect(on(await Comments.find({ content: 'Seed comment, added in a test.' }).lean(), 'studentId', own)).toBeDefined();
    });
  });

  test("staff read and change a comment or a note on a partner's student as before", async () => {
    const partners = theirs(u.subAgentA, 'Applied');
    const comment = seed.comments.find((c) => String(c.studentId) === String(partners._id));
    const note = seed.notes.find((n) => String(n.student) === String(partners._id));

    await as(u.counsellorB).get(`/v1/comments/${comment._id}`).expect(httpStatus.OK);
    await as(u.counsellorB)
      .patch(`/v1/comments/${comment._id}`, { content: 'Seed comment, changed by staff.' })
      .expect(httpStatus.OK);
    await as(u.counsellorB).patch(`/v1/notes/${note._id}`, { body: 'Seed note, changed by staff.' }).expect(httpStatus.OK);

    expect((await Comments.findById(comment._id).lean()).content).toBe('Seed comment, changed by staff.');
    expect((await Note.findById(note._id).lean()).body).toBe('Seed note, changed by staff.');
  });

  test('none of this tried to reach anything outside the machine', () => {
    expect(blocked).toEqual([]);
  });
});
