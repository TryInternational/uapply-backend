const request = require('supertest');
const httpStatus = require('http-status');
const app = require('../../src/app');
const setupTestDB = require('../utils/setupTestDB');
const { Students, Application, Documents, Notifications } = require('../../src/models');
const { loadSeed } = require('../seed/loadSeed');
const { PHASES, phasesUpTo } = require('../factories');
const { accessTokenFor } = require('../fixtures/token.fixture');
const { blocked } = require('../utils/blockNetwork');

setupTestDB();

/**
 * Applications and documents, as staff use them: adding an application, moving
 * it through its eight phases, the lists, and the documents on a student.
 *
 * How a phase move is sent: the client sends the application's phase list back
 * with `phaseChanged: true`. The phase marked as current is the one being
 * completed. Without `holdPhase` the server completes it and moves the marker
 * to the next phase; with `holdPhase: true` the client has already put the
 * marker where it wants it, and the server leaves it there.
 */

const idsOf = (list) => list.map((record) => String(record.id || record._id)).sort();
const currentOf = (anApplication) => anApplication.portalApplicationStatus.applicationPhases.find((p) => p.isCurrent).status;
const phase = (anApplication, status) =>
  anApplication.portalApplicationStatus.applicationPhases.find((p) => p.status === status);

describe('applications and documents', () => {
  let seed;
  let u;
  let startedAt;
  const as = (user) => {
    const token = `Bearer ${accessTokenFor(user)}`;
    return {
      get: (path) => request(app).get(path).set('Authorization', token),
      post: (path, body = {}) => request(app).post(path).set('Authorization', token).send(body),
      patch: (path, body = {}) => request(app).patch(path).set('Authorization', token).send(body),
      delete: (path) => request(app).delete(path).set('Authorization', token),
    };
  };
  const editor = (user) => ({ id: String(user._id), name: user.name });
  const stored = (anApplication) => Application.findById(anApplication._id || anApplication.id).lean();
  const seededAt = (status) => seed.applications.find((a) => currentOf(a) === status && a.reviewStatus === 'APPROVED');
  const studentOf = (anApplication) => seed.students.find((s) => String(s._id) === String(anApplication.studentId));

  // Completes the phase an application is at: sends its own phase list back.
  const complete = async (user, anApplication, extra = {}) => {
    const now = await stored(anApplication);
    return as(user).patch(`/v1/application/${now._id}`, {
      phaseChanged: true,
      editor: editor(user),
      portalApplicationStatus: now.portalApplicationStatus,
      ...extra,
    });
  };
  // Puts the marker on a phase and asks the server to leave it there.
  const placeAt = (user, anApplication, status, extra = {}) =>
    as(user).patch(`/v1/application/${anApplication._id}`, {
      phaseChanged: true,
      holdPhase: true,
      editor: editor(user),
      portalApplicationStatus: { applicationPhases: phasesUpTo(status, anApplication.createdAt) },
      ...extra,
    });

  beforeEach(async () => {
    seed = await loadSeed();
    u = seed.users;
    startedAt = Date.now();
  });

  describe('adding an application', () => {
    const body = (aStudent, extra = {}) => ({
      studentId: String(aStudent._id),
      courseName: 'Seed Course for a test',
      courseLevel: 'Undergraduate',
      intakeMonth: 'January',
      intakeYear: 2027,
      institute: { name: 'Seed University 1' },
      editor: editor(u.counsellorA),
      ...extra,
    });
    const aStudent = () =>
      seed.studentsOwnedBy(u.counsellorA).find((s) => s.channel === 'direct' && s.stage === 'NotApplied');

    test('staff add one: it needs no review and starts at the first phase', async () => {
      const res = await as(u.counsellorA).post('/v1/application', body(aStudent())).expect(httpStatus.CREATED);

      const made = await stored(res.body);
      expect(made).toMatchObject({ reviewStatus: 'APPROVED', courseName: 'Seed Course for a test', intakeYear: 2027 });
      expect(made.reviewHistory).toEqual([]);
      expect(String(made.studentId)).toBe(String(aStudent()._id));
      expect(made.portalApplicationStatus.applicationPhases.map((p) => p.status)).toEqual(PHASES);
      expect(currentOf(made)).toBe('Initiated');
      expect(phase(made, 'Initiated').phaseState).toBe('AwaitingResponseStudent');
      expect(phase(made, 'Initiated').createdDate.getTime()).toBeGreaterThanOrEqual(startedAt);
      made.portalApplicationStatus.applicationPhases.slice(1).forEach((p) => expect(p.phaseState).toBe('Upcoming'));
    });

    test('whatever the request says, it is recorded as made by the caller and not as reviewed by anyone', async () => {
      const res = await as(u.counsellorA)
        .post(
          '/v1/application',
          body(aStudent(), {
            createdBy: String(u.admin._id),
            reviewStatus: 'REJECTED',
            reviewHistory: [{ action: 'REJECTED', byName: 'Somebody' }],
          })
        )
        .expect(httpStatus.CREATED);

      const made = await stored(res.body);
      expect(String(made.createdBy)).toBe(String(u.counsellorA._id));
      expect(made.reviewStatus).toBe('APPROVED');
      expect(made.reviewHistory).toEqual([]);
    });

    // The message for the student's team is written after the application is
    // stored. It used to read the name from `editor` in the request and the
    // institute's name from the application; with either missing the request
    // was answered 500 although the application was there, and a caller told
    // "500" would send it again.
    const toldAbout = (anApplication) =>
      Notifications.find({ type: 'application', applicationId: anApplication._id }).lean();
    const applicationsOf = (student) => Application.find({ studentId: student._id }).lean();

    test("a request that names no editor is answered 201, and the team is told under the caller's name", async () => {
      const student = aStudent();
      const before = (await applicationsOf(student)).length;

      const res = await as(u.counsellorA).post('/v1/application', body(student, { editor: undefined }));

      expect(res.status).toBe(httpStatus.CREATED);
      expect(await applicationsOf(student)).toHaveLength(before + 1);
      const told = await toldAbout(await stored(res.body));
      expect(told).toHaveLength(1);
      expect(told[0].message).toContain(`initiated by ${u.counsellorA.name} for`);
      expect(String(told[0].createdBy)).toBe(String(u.counsellorA._id));
    });

    test('a request that names no institute is answered 201, and the team is still told', async () => {
      const student = aStudent();
      const before = (await applicationsOf(student)).length;

      const res = await as(u.counsellorA).post('/v1/application', body(student, { institute: undefined }));

      expect(res.status).toBe(httpStatus.CREATED);
      expect(await applicationsOf(student)).toHaveLength(before + 1);
      const told = await toldAbout(await stored(res.body));
      expect(told).toHaveLength(1);
      expect(told[0].message).toContain(`initiated by ${u.counsellorA.name} for`);
      expect(told[0].message).not.toMatch(/undefined/);
    });

    test('the team is told who added it from the session, whatever name the request gives', async () => {
      const res = await as(u.counsellorA)
        .post('/v1/application', body(aStudent(), { editor: { id: String(u.admin._id), name: 'Somebody Else' } }))
        .expect(httpStatus.CREATED);

      const told = await toldAbout(await stored(res.body));
      expect(told).toHaveLength(1);
      expect(told[0].message).toContain(`initiated by ${u.counsellorA.name} for`);
      expect(told[0].message).not.toContain('Somebody Else');
      expect(String(told[0].createdBy)).toBe(String(u.counsellorA._id));
    });
  });

  describe('moving an application through its phases', () => {
    test('completing the current phase moves the marker to the next, and stamps when', async () => {
      const application = seededAt('Submitted');

      expect((await complete(u.counsellorA, application)).status).toBe(httpStatus.OK);

      const now = await stored(application);
      expect(currentOf(now)).toBe('Conditional offer');
      expect(phase(now, 'Submitted')).toMatchObject({ phaseState: 'Completed', isCurrent: false, isPrevious: true });
      expect(phase(now, 'Conditional offer')).toMatchObject({ phaseState: 'AwaitingResponseStudent', isCurrent: true });
      expect(phase(now, 'Initiated').isPrevious).toBe(false);
      // The phase left is closed, and the phase entered is opened, at the same moment.
      expect(phase(now, 'Submitted').updatedDate.getTime()).toBeGreaterThanOrEqual(startedAt);
      expect(phase(now, 'Conditional offer').createdDate.getTime()).toBe(phase(now, 'Submitted').updatedDate.getTime());
      // Later phases are untouched.
      expect(phase(now, 'Unconditional offer').phaseState).toBe('Upcoming');
      expect(phase(now, 'Unconditional offer').createdDate).toBeUndefined();
    });

    test('each move goes one phase further', async () => {
      const application = seededAt('Submitted');

      expect((await complete(u.counsellorA, application)).status).toBe(httpStatus.OK);
      expect((await complete(u.counsellorA, application)).status).toBe(httpStatus.OK);
      expect((await complete(u.counsellorA, application)).status).toBe(httpStatus.OK);

      const now = await stored(application);
      expect(currentOf(now)).toBe('Confirmation');
      expect(now.portalApplicationStatus.applicationPhases.filter((p) => p.isCurrent)).toHaveLength(1);
      expect(
        now.portalApplicationStatus.applicationPhases.filter((p) => p.phaseState === 'Completed').map((p) => p.status)
      ).toEqual(['Initiated', 'Submitted', 'Conditional offer', 'Unconditional offer']);
    });

    test('what was captured at a phase is added to the record, and earlier entries are kept', async () => {
      const application = seededAt('Submitted');

      expect(
        (
          await complete(u.counsellorA, application, {
            stageRecord: {
              fields: { offerDate: '2026-02-01' },
              docs: ['Passport', 'Academic Transcript'],
              note: 'Seed note: sent to the university.',
            },
          })
        ).status
      ).toBe(httpStatus.OK);
      expect(
        (await complete(u.counsellorB, application, { stageRecord: { note: 'Seed note: offer received.' } })).status
      ).toBe(httpStatus.OK);

      const { stageRecords } = await stored(application);
      expect(stageRecords).toHaveLength(2);
      expect(stageRecords[0]).toMatchObject({
        stage: 'Submitted',
        fields: { offerDate: '2026-02-01' },
        docs: ['Passport', 'Academic Transcript'],
        note: 'Seed note: sent to the university.',
        byName: u.counsellorA.name,
      });
      expect(String(stageRecords[0].by)).toBe(String(u.counsellorA._id));
      expect(stageRecords[1]).toMatchObject({
        stage: 'Conditional offer',
        note: 'Seed note: offer received.',
        docs: [],
      });
      expect(String(stageRecords[1].by)).toBe(String(u.counsellorB._id));
    });

    test('a move with nothing captured adds nothing to the record', async () => {
      const application = seededAt('Submitted');

      expect((await complete(u.counsellorA, application)).status).toBe(httpStatus.OK);

      expect((await stored(application)).stageRecords).toEqual([]);
    });

    describe('when the caller places the marker itself', () => {
      test('the server leaves it where it was put, and stamps the phase entered', async () => {
        const application = seededAt('Submitted');

        await placeAt(u.counsellorA, application, 'Unconditional offer').expect(httpStatus.OK);

        const now = await stored(application);
        expect(currentOf(now)).toBe('Unconditional offer');
        expect(phase(now, 'Unconditional offer').createdDate.getTime()).toBeGreaterThanOrEqual(startedAt);
        expect(phase(now, 'Conditional offer').updatedDate.getTime()).toBeGreaterThanOrEqual(startedAt);
        expect(phase(now, 'Confirmation').phaseState).toBe('Upcoming');
      });

      test('a request that leaves the marker where it is does not restart the clock', async () => {
        const application = seededAt('Submitted');
        const before = phase(await stored(application), 'Submitted').createdDate.getTime();

        await placeAt(u.counsellorA, application, 'Submitted').expect(httpStatus.OK);

        const now = await stored(application);
        expect(currentOf(now)).toBe('Submitted');
        expect(phase(now, 'Submitted').createdDate.getTime()).toBe(before);
        expect(before).toBeLessThan(startedAt);
      });

      test('what was captured is recorded against the phase the marker is on', async () => {
        const application = seededAt('Submitted');

        await placeAt(u.counsellorA, application, 'Conditional offer', {
          stageRecord: { note: 'Seed note: conditions listed.' },
        }).expect(httpStatus.OK);

        expect((await stored(application)).stageRecords).toMatchObject([
          { stage: 'Conditional offer', note: 'Seed note: conditions listed.' },
        ]);
      });
    });

    test('completing the last phase enrols the student', async () => {
      // Counsellor B's student at Applied has an application at CAS Received and no other place held.
      const application = seededAt('CAS Received');
      const student = studentOf(application);
      expect(student.stage).toBe('Applied');

      expect((await complete(u.counsellorB, application)).status).toBe(httpStatus.OK);
      expect(currentOf(await stored(application))).toBe('Done');
      expect((await Students.findById(student._id).lean()).stage).toBe('Applied');

      expect((await complete(u.counsellorB, application)).status).toBe(httpStatus.OK);

      const now = await stored(application);
      expect(phase(now, 'Done').phaseState).toBe('Completed');
      const enrolled = await Students.findById(student._id).lean();
      expect(enrolled.stage).toBe('Enrolled');
      expect(enrolled.enrolledAt.getTime()).toBeGreaterThanOrEqual(startedAt);
    });

    test('the first phase is completed like any other', async () => {
      const application = seededAt('Initiated');

      expect((await complete(u.counsellorA, application)).status).toBe(httpStatus.OK);

      const now = await stored(application);
      expect(currentOf(now)).toBe('Submitted');
      expect(phase(now, 'Initiated')).toMatchObject({ phaseState: 'Completed', isCurrent: false, isPrevious: true });
      expect(phase(now, 'Submitted').createdDate.getTime()).toBeGreaterThanOrEqual(startedAt);
    });

    test('an application staff add can be walked from the first phase to the last, and the student ends up enrolled', async () => {
      const student = seed.studentsOwnedBy(u.counsellorA).find((s) => s.channel === 'direct' && s.stage === 'NotApplied');
      const added = await as(u.counsellorA)
        .post('/v1/application', {
          studentId: String(student._id),
          courseName: 'Seed Course for a test',
          courseLevel: 'Undergraduate',
          intakeMonth: 'January',
          intakeYear: 2027,
          institute: { name: 'Seed University 1' },
          editor: editor(u.counsellorA),
        })
        .expect(httpStatus.CREATED);
      const application = { _id: added.body._id };

      const reached = [];
      // eslint-disable-next-line no-restricted-syntax
      for (const expected of [...PHASES.slice(1), 'Done']) {
        // eslint-disable-next-line no-await-in-loop
        expect((await complete(u.counsellorA, application)).status).toBe(httpStatus.OK);
        // eslint-disable-next-line no-await-in-loop
        const now = await stored(application);
        reached.push((now.portalApplicationStatus.applicationPhases.find((p) => p.isCurrent) || { status: 'Done' }).status);
        expect(reached[reached.length - 1]).toBe(expected);
      }

      const finished = await stored(application);
      finished.portalApplicationStatus.applicationPhases.forEach((p) => expect(p.phaseState).toBe('Completed'));
      expect((await Students.findById(student._id).lean()).stage).toBe('Enrolled');
    });

    test('who is making the move is taken from the signed-in user when the request does not say', async () => {
      const application = seededAt('Submitted');
      const now = await stored(application);

      await as(u.counsellorB)
        .patch(`/v1/application/${application._id}`, {
          phaseChanged: true,
          portalApplicationStatus: now.portalApplicationStatus,
          stageRecord: { note: 'Seed note: no editor was sent.' },
        })
        .expect(httpStatus.OK);

      const after = await stored(application);
      expect(currentOf(after)).toBe('Conditional offer');
      expect(after.stageRecords).toMatchObject([{ stage: 'Submitted', byName: u.counsellorB.name }]);
    });

    test('a phase change that sends no phases is refused, and nothing changes', async () => {
      const application = seededAt('Submitted');

      await as(u.counsellorA)
        .patch(`/v1/application/${application._id}`, { phaseChanged: true, editor: editor(u.counsellorA) })
        .expect(httpStatus.BAD_REQUEST);
      await as(u.counsellorA)
        .patch(`/v1/application/${application._id}`, {
          phaseChanged: true,
          portalApplicationStatus: { applicationPhases: [] },
        })
        .expect(httpStatus.BAD_REQUEST);

      expect(currentOf(await stored(application))).toBe('Submitted');
    });

    test('a phase change for an application that does not exist is 404', async () => {
      const phases = (await stored(seededAt('Submitted'))).portalApplicationStatus;

      await as(u.counsellorA)
        .patch('/v1/application/5eed00040000000000ffffff', {
          phaseChanged: true,
          editor: editor(u.counsellorA),
          portalApplicationStatus: phases,
        })
        .expect(httpStatus.NOT_FOUND);
    });

    describe('one place for each intake', () => {
      // Counsellor A's student at Applied has two applications for September 2026:
      // one at Confirmation, which holds the place, and one still at Initiated.
      const theStudent = () =>
        seed.studentsOwnedBy(u.counsellorA).find((s) => s.channel === 'direct' && s.stage === 'Applied');
      const holder = () => seed.applicationsOf(theStudent()).find((a) => currentOf(a) === 'Confirmation');
      const second = () => seed.applicationsOf(theStudent()).find((a) => currentOf(a) === 'Initiated');

      test('a second application cannot reach Confirmation while another holds the place, and the caller is told why', async () => {
        const res = await placeAt(u.counsellorA, second(), 'Confirmation').expect(httpStatus.CONFLICT);

        expect(res.body.message).toContain(holder().institute.name);
        expect(res.body.message).toContain('September 2026');
        expect(currentOf(await stored(second()))).toBe('Initiated');
      });

      test('the same is true when the server moves the marker itself', async () => {
        // Put the second application at Confirmation's doorstep, then complete Confirmation.
        await placeAt(u.counsellorA, second(), 'Unconditional offer').expect(httpStatus.OK);
        expect((await complete(u.counsellorA, second())).status).toBe(httpStatus.OK);
        expect(currentOf(await stored(second()))).toBe('Confirmation');

        expect((await complete(u.counsellorA, second())).status).toBe(httpStatus.CONFLICT);

        expect(currentOf(await stored(second()))).toBe('Confirmation');
      });

      test('below Confirmation the second application moves freely', async () => {
        await placeAt(u.counsellorA, second(), 'Unconditional offer').expect(httpStatus.OK);

        expect(currentOf(await stored(second()))).toBe('Unconditional offer');
      });

      test('an application for another intake is not held back', async () => {
        await as(u.counsellorA).patch(`/v1/application/${second()._id}`, { intakeYear: 2027 }).expect(httpStatus.OK);

        await placeAt(u.counsellorA, second(), 'Confirmation').expect(httpStatus.OK);

        expect(currentOf(await stored(second()))).toBe('Confirmation');
      });

      test('a rejected application does not hold the place', async () => {
        await as(u.counsellorA).patch(`/v1/application/${holder()._id}`, { rejected: true }).expect(httpStatus.OK);

        await placeAt(u.counsellorA, second(), 'Confirmation').expect(httpStatus.OK);

        expect(currentOf(await stored(second()))).toBe('Confirmation');
      });
    });

    test('a partner cannot move an application, their own included', async () => {
      const theirs = seed.applications.find((a) => String(a.createdBy) === String(u.schoolB._id));
      const before = currentOf(await stored(theirs));

      expect((await complete(u.schoolB, theirs)).status).toBe(httpStatus.FORBIDDEN);
      expect((await complete(u.subAgentA, theirs)).status).toBe(httpStatus.FORBIDDEN);

      expect(currentOf(await stored(theirs))).toBe(before);
    });
  });

  describe('changing and deleting', () => {
    test('staff change the details without touching the phases', async () => {
      const application = seededAt('Submitted');

      await as(u.counsellorA)
        .patch(`/v1/application/${application._id}`, {
          comments: 'Seed comment for a test.',
          managedBy: String(u.counsellorB._id),
          intakeMonth: 'January',
        })
        .expect(httpStatus.OK);

      const now = await stored(application);
      expect(now).toMatchObject({
        comments: 'Seed comment for a test.',
        managedBy: String(u.counsellorB._id),
        intakeMonth: 'January',
      });
      expect(currentOf(now)).toBe('Submitted');
    });

    test('staff delete one', async () => {
      const application = seededAt('Submitted');

      await as(u.counsellorA).delete(`/v1/application/${application._id}`).expect(httpStatus.NO_CONTENT);

      expect(await stored(application)).toBeNull();
      expect(await Application.countDocuments()).toBe(seed.applications.length - 1);
    });
  });

  describe('the lists', () => {
    test('staff are given every application that is past review, and none that is still with a partner or a reviewer', async () => {
      const res = await as(u.staff).get('/v1/application').expect(httpStatus.OK);

      const pastReview = seed.applications.filter((a) => a.reviewStatus === 'APPROVED');
      expect(idsOf(res.body)).toEqual(idsOf(pastReview));
      expect(pastReview).toHaveLength(10);
    });

    test("a student's applications", async () => {
      const student = studentOf(seededAt('Done'));

      const res = await as(u.staff).get(`/v1/application/student/${student._id}`).expect(httpStatus.OK);

      expect(idsOf(res.body)).toEqual(idsOf(seed.applicationsOf(student)));
      expect(res.body).toHaveLength(2);
    });

    test('a student with none has an empty list', async () => {
      const student = seed.students.find((s) => s.channel === 'lead');

      const res = await as(u.staff).get(`/v1/application/student/${student._id}`).expect(httpStatus.OK);

      expect(res.body).toEqual([]);
    });

    test('one application by id, and 404 for one that does not exist', async () => {
      const application = seededAt('Done');

      const res = await as(u.staff).get(`/v1/application/${application._id}`).expect(httpStatus.OK);
      expect(res.body.applicationId).toBe(application.applicationId);

      await as(u.staff).get('/v1/application/5eed00040000000000ffffff').expect(httpStatus.NOT_FOUND);
    });

    describe('waiting for review', () => {
      test('a reviewer and an admin see what partners have sent in and nothing else', async () => {
        const waiting = seed.applications.filter((a) =>
          ['SUBMITTED_BY_SUBAGENT', 'SUBMITTED_BY_COUNSELOR'].includes(a.reviewStatus)
        );

        const forReviewer = await as(u.reviewer).get('/v1/application/pending-review').expect(httpStatus.OK);
        const forAdmin = await as(u.admin).get('/v1/application/pending-review').expect(httpStatus.OK);

        expect(idsOf(forReviewer.body)).toEqual(idsOf(waiting));
        expect(idsOf(forAdmin.body)).toEqual(idsOf(waiting));
        expect(waiting).toHaveLength(2);
      });

      test('nobody without the review right sees it', async () => {
        await as(u.staff).get('/v1/application/pending-review').expect(httpStatus.FORBIDDEN);
        await as(u.counsellorA).get('/v1/application/pending-review').expect(httpStatus.FORBIDDEN);
        await as(u.subAgentA).get('/v1/application/pending-review').expect(httpStatus.FORBIDDEN);
        await as(u.schoolA).get('/v1/application/pending-review').expect(httpStatus.FORBIDDEN);
      });
    });
  });

  describe('documents on a student', () => {
    const aStudent = () =>
      seed.studentsOwnedBy(u.counsellorA).find((s) => s.channel === 'direct' && s.stage === 'NotApplied');
    const add = (extra = {}) =>
      as(u.counsellorA).post('/v1/documents', {
        studentId: String(aStudent()._id),
        documentType: 'Passport',
        docState: 'Requested',
        ...extra,
      });

    test('staff ask for one, mark it verified, read it and delete it', async () => {
      const added = await add().expect(httpStatus.CREATED);
      const { id } = added.body;
      expect(added.body).toMatchObject({
        documentType: 'Passport',
        docState: 'Requested',
        studentId: String(aStudent()._id),
      });

      await as(u.counsellorA).patch(`/v1/documents/${id}`, { docState: 'Verified' }).expect(httpStatus.OK);
      const read = await as(u.counsellorA).get(`/v1/documents/${id}`).expect(httpStatus.OK);
      expect(read.body.docState).toBe('Verified');

      const theirs = await as(u.counsellorA).get(`/v1/documents/student/${aStudent()._id}`).expect(httpStatus.OK);
      expect(idsOf(theirs.body)).toEqual([id]);

      await as(u.counsellorA).delete(`/v1/documents/${id}`).expect(httpStatus.NO_CONTENT);
      expect(await Documents.findById(id).lean()).toBeNull();
    });

    test('a document needs a type, and a state the model knows', async () => {
      const before = await Documents.countDocuments();

      await add({ documentType: undefined }).expect(httpStatus.BAD_REQUEST);
      await add({ docState: 'Shredded' }).expect(httpStatus.BAD_REQUEST);

      expect(await Documents.countDocuments()).toBe(before);
    });

    test('one that does not exist is 404 to read, change or delete', async () => {
      const nothing = '5eed00050000000000ffffff';

      await as(u.counsellorA).get(`/v1/documents/${nothing}`).expect(httpStatus.NOT_FOUND);
      await as(u.counsellorA).patch(`/v1/documents/${nothing}`, { docState: 'Verified' }).expect(httpStatus.NOT_FOUND);
      await as(u.counsellorA).delete(`/v1/documents/${nothing}`).expect(httpStatus.NOT_FOUND);
    });

    test('the list is given a page at a time', async () => {
      const res = await as(u.staff).get('/v1/documents?limit=4').expect(httpStatus.OK);

      expect(res.body).toMatchObject({ limit: 4, totalResults: seed.documents.length });
      expect(res.body.results).toHaveLength(4);
    });
  });

  describe('reading a passport from a stored scan', () => {
    const read = (blobUrl) => as(u.schoolA).post('/v1/documents/passport-extract', { blobUrl }).expect(httpStatus.OK);

    test.each([
      ['something that is not an address', 'not a url', 'INVALID_URL'],
      ['no address at all', undefined, 'INVALID_URL'],
      ['an address that is not https', 'http://firebasestorage.googleapis.com/v0/b/seed/o/passport.jpg', 'URL_NOT_ALLOWED'],
      ['a cloud metadata address', 'https://169.254.169.254/latest/meta-data', 'URL_NOT_ALLOWED'],
      ['this machine', 'https://localhost/passport.jpg', 'URL_NOT_ALLOWED'],
      ['an address on the private network', 'https://10.0.0.1/passport.jpg', 'URL_NOT_ALLOWED'],
      ["somebody else's site", 'https://files.example.com/passport.jpg', 'URL_NOT_ALLOWED'],
      [
        'a site named to look like storage',
        'https://firebasestorage.googleapis.com.example.com/passport.jpg',
        'URL_NOT_ALLOWED',
      ],
      [
        'a site with storage in the middle of its name',
        'https://seed.firebasestorage.app.example.com/passport.jpg',
        'URL_NOT_ALLOWED',
      ],
    ])('refuses %s, and fetches nothing', async (what, blobUrl, reason) => {
      const attemptsBefore = blocked.length;

      const res = await read(blobUrl);

      expect(res.body).toEqual({ ok: false, reason, fields: null });
      expect(blocked).toHaveLength(attemptsBefore);
    });

    test('only for an address in storage does it try to fetch, and a failed fetch is reported, not thrown', async () => {
      const attemptsBefore = blocked.length;

      const res = await read('https://firebasestorage.googleapis.com/v0/b/seed/o/passport.jpg');

      // The test run blocks every call that leaves the machine, so the fetch fails.
      expect(res.body).toEqual({ ok: false, reason: 'FETCH_FAILED', fields: null });
      expect(blocked.slice(attemptsBefore)).toEqual(['firebasestorage.googleapis.com:443']);
    });

    test('is for school counsellors only', async () => {
      await as(u.subAgentA).post('/v1/documents/passport-extract', { blobUrl: 'not a url' }).expect(httpStatus.FORBIDDEN);
      await as(u.counsellorA).post('/v1/documents/passport-extract', { blobUrl: 'not a url' }).expect(httpStatus.FORBIDDEN);
    });
  });

  // How things are today, not how they are meant to be. None of these lets
  // anybody see or change what they should not. When one is changed, its test
  // fails and is rewritten to say what is then true.
  describe('not as one would expect yet', () => {
    test('changing or deleting an application that does not exist is answered as if it had worked', async () => {
      const nothing = '5eed00040000000000ffffff';

      const changed = await as(u.counsellorA).patch(`/v1/application/${nothing}`, { comments: 'x' }).expect(httpStatus.OK);
      expect(changed.body).toEqual({});

      await as(u.counsellorA).delete(`/v1/application/${nothing}`).expect(httpStatus.NO_CONTENT);
    });

    test('a value the model does not allow is stored when an application is changed', async () => {
      const application = seededAt('Submitted');

      await as(u.counsellorA)
        .patch(`/v1/application/${application._id}`, { agent: 'Nobody', reviewStatus: 'Whatever' })
        .expect(httpStatus.OK);

      expect(await stored(application)).toMatchObject({ agent: 'Nobody', reviewStatus: 'Whatever' });
    });

    test("an application staff add is not put on the student's own list of applications; a partner's is", async () => {
      const student = seed.studentsOwnedBy(u.counsellorA).find((s) => s.channel === 'direct' && s.stage === 'NotApplied');

      const res = await as(u.counsellorA)
        .post('/v1/application', {
          studentId: String(student._id),
          courseName: 'Seed Course for a test',
          courseLevel: 'Undergraduate',
          intakeMonth: 'January',
          intakeYear: 2027,
          institute: { name: 'Seed University 1' },
          editor: editor(u.counsellorA),
        })
        .expect(httpStatus.CREATED);

      const now = await Students.findById(student._id).lean();
      expect(now.applications.map(String)).not.toContain(String(res.body._id));
      expect(now.stage).toBe('NotApplied');
    });
  });
});
