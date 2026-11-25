const request = require('supertest');
const httpStatus = require('http-status');
const app = require('../../src/app');
const setupTestDB = require('../utils/setupTestDB');
const { Students } = require('../../src/models');
const { loadSeed } = require('../seed/loadSeed');
const { accessTokenFor } = require('../fixtures/token.fixture');
const { blocked } = require('../utils/blockNetwork');

setupTestDB();

/**
 * Student management, as staff use it: the list and its filters, the counts,
 * search, adding and changing a student, assignment, and starting a new
 * journey.
 *
 * The answers are known because the seed is fixed: 23 students, whose stage,
 * owner, channel, school and applications are set out in tests/seed/buildSeed.js.
 * Expected results are worked out from the seed's own records, so a change to
 * the seed does not quietly make a test pass for the wrong reason.
 */

const idsOf = (list) => list.map((record) => String(record.id || record._id)).sort();

describe('student management', () => {
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
  const list = async (query) => {
    const res = await as(u.staff)
      .get(`/v1/students?limit=100${query ? `&${query}` : ''}`)
      .expect(httpStatus.OK);
    return res.body;
  };
  const inDb = (aStudent) => Students.findById(aStudent._id || aStudent.id).lean();
  const where = (test) => seed.students.filter(test);

  beforeEach(async () => {
    seed = await loadSeed();
    u = seed.users;
  });

  describe('the list', () => {
    test('holds every student for staff, a page at a time', async () => {
      const all = await list();
      expect(all.totalResults).toBe(23);
      expect(idsOf(all.results)).toEqual(idsOf(seed.students));

      const firstPage = await as(u.staff).get('/v1/students?limit=5&page=1').expect(httpStatus.OK);
      const lastPage = await as(u.staff).get('/v1/students?limit=5&page=5').expect(httpStatus.OK);
      expect(firstPage.body).toMatchObject({ page: 1, limit: 5, totalPages: 5, totalResults: 23 });
      expect(firstPage.body.results).toHaveLength(5);
      expect(lastPage.body.results).toHaveLength(3);
    });

    test('sorts by the field asked for', async () => {
      const newestFirst = await list('sortBy=createdAt:desc');
      const oldestFirst = await list('sortBy=createdAt:asc');

      const dates = (body) => body.results.map((s) => new Date(s.createdAt).getTime());
      expect(dates(newestFirst)).toEqual([...dates(newestFirst)].sort((a, b) => b - a));
      expect(dates(oldestFirst)).toEqual([...dates(oldestFirst)].sort((a, b) => a - b));
    });

    test.each(['NotApplied', 'Applied', 'Lost', 'Enrolled', 'PendingReview', 'Denied'])(
      'filters by stage %s',
      async (stage) => {
        const body = await list(`stage=${stage}`);

        expect(idsOf(body.results)).toEqual(idsOf(seed.studentsInStage(stage)));
        expect(body.results.length).toBeGreaterThan(0);
      }
    );

    test('filters by several stages at once', async () => {
      const body = await list('stage=Lost,Denied');

      expect(idsOf(body.results)).toEqual(idsOf(where((s) => ['Lost', 'Denied'].includes(s.stage))));
    });

    test.each(['direct', 'subagent', 'counselor', 'lead'])('filters by channel %s', async (channel) => {
      const body = await list(`channel=${channel}`);

      expect(idsOf(body.results)).toEqual(idsOf(where((s) => s.channel === channel)));
      expect(body.results.length).toBeGreaterThan(0);
    });

    test('filters by the school a student came from', async () => {
      const body = await list(`school=${encodeURIComponent('Seed School A')}`);

      expect(idsOf(body.results)).toEqual(idsOf(seed.studentsOwnedBy(u.schoolA)));
    });

    test('filters combine: a stage within a channel', async () => {
      const body = await list('channel=subagent&stage=PendingReview');

      expect(idsOf(body.results)).toEqual(idsOf(where((s) => s.channel === 'subagent' && s.stage === 'PendingReview')));
      expect(body.results).toHaveLength(2);
    });

    test('a filter that matches nobody gives an empty page, not an error', async () => {
      const body = await list('channel=campaign');

      expect(body).toMatchObject({ results: [], totalResults: 0 });
    });

    describe('by who is assigned', () => {
      const assignedTo = (aUser) => where((s) => s.assignedTo.some((a) => String(a.user) === String(aUser._id)));

      test('one member of staff', async () => {
        const body = await list(`assignedUserId=${u.counsellorA._id}`);

        expect(idsOf(body.results)).toEqual(idsOf(assignedTo(u.counsellorA)));
        expect(body.results).toHaveLength(8);
      });

      test('a member of staff in a named slot, whatever the capitals', async () => {
        const inSlot = await list(
          `assignedSlots=${encodeURIComponent(JSON.stringify([{ user: u.counsellorB._id, role: 'COUNSELLOR' }]))}`
        );
        const inAnotherSlot = await list(
          `assignedSlots=${encodeURIComponent(JSON.stringify([{ user: u.counsellorB._id, role: 'sales' }]))}`
        );

        expect(idsOf(inSlot.results)).toEqual(idsOf(assignedTo(u.counsellorB)));
        expect(inAnotherSlot.results).toEqual([]);
      });

      test('everyone holding a role', async () => {
        const body = await list(`assignedUserRoleId=${seed.roles.counsellor._id}`);

        expect(idsOf(body.results)).toEqual(idsOf(where((s) => s.assignedTo.length > 0)));
      });

      test.each([
        ['assignedUserId', 'not-an-id'],
        ['assignedSlots', 'not-json'],
        ['assignedSlots', encodeURIComponent(JSON.stringify({ user: 'x' }))],
        ['assignedUsersWithRoles', 'not-json'],
      ])('a malformed %s is refused, not ignored', async (name, value) => {
        await as(u.staff).get(`/v1/students?${name}=${value}`).expect(httpStatus.BAD_REQUEST);
      });
    });

    describe('by their applications', () => {
      const studentsWithAnApplicationAt = (phases) => {
        const ids = seed.applications
          .filter((a) => phases.includes(a.portalApplicationStatus.applicationPhases.find((p) => p.isCurrent).status))
          .map((a) => String(a.studentId));
        return where((s) => ids.includes(String(s._id)));
      };

      test.each([['Done'], ['Initiated'], ['Conditional offer']])('students with an application at %s', async (phase) => {
        const body = await list(`appStage=${encodeURIComponent(phase)}`);

        expect(idsOf(body.results)).toEqual(idsOf(studentsWithAnApplicationAt([phase])));
        expect(body.results.length).toBeGreaterThan(0);
      });

      test('students with an application at either of two phases', async () => {
        const body = await list(`appStage=${encodeURIComponent('CAS Received,Done')}`);

        expect(idsOf(body.results)).toEqual(idsOf(studentsWithAnApplicationAt(['CAS Received', 'Done'])));
      });
    });
  });

  describe('the counts', () => {
    test('by stage, for the stages asked for', async () => {
      const res = await as(u.staff)
        .get('/v1/students?countsByStage=NotApplied,Applied,Lost,Enrolled,PendingReview,Denied')
        .expect(httpStatus.OK);

      expect(res.body).toEqual({
        counts: { NotApplied: 5, Applied: 6, Lost: 2, Enrolled: 4, PendingReview: 4, Denied: 2 },
      });
    });

    test('by stage, within the other filters and whatever stage filter is set', async () => {
      const res = await as(u.staff)
        .get('/v1/students?channel=subagent&stage=Applied&countsByStage=PendingReview,Applied,Lost')
        .expect(httpStatus.OK);

      expect(res.body).toEqual({ counts: { PendingReview: 2, Applied: 2, Lost: 0 } });
    });

    test('by who is assigned', async () => {
      const res = await as(u.staff).get('/v1/students/counts-by-user').expect(httpStatus.OK);

      expect(res.body).toEqual({
        counts: { [String(u.counsellorA._id)]: 8, [String(u.counsellorB._id)]: 8 },
      });
    });
  });

  describe('search', () => {
    const search = async (text, query = '') => {
      const res = await as(u.staff)
        .get(`/v1/students/search/${encodeURIComponent(text)}?limit=100${query}`)
        .expect(httpStatus.OK);
      return res.body.results;
    };
    const first = () => seed.students[0];

    test('finds a student by first name, in any capitals', async () => {
      const expected = where((s) => s.firstName === first().firstName);

      expect(idsOf(await search(first().firstName.toUpperCase()))).toEqual(idsOf(expected));
      expect(expected.length).toBeGreaterThan(1);
    });

    test('finds a student by family name, part of a phone number, e-mail address or reference', async () => {
      expect(idsOf(await search('Sampleton'))).toEqual(idsOf(where((s) => s.lastName.includes('Sampleton'))));
      expect(idsOf(await search(first().phoneNo.slice(-6)))).toEqual([String(first()._id)]);
      expect(idsOf(await search(first().email))).toEqual([String(first()._id)]);
      expect(idsOf(await search(first().refrenceNo))).toEqual([String(first()._id)]);
    });

    test('finds nobody for text that is in no student', async () => {
      expect(await search('Nobodyatall')).toEqual([]);
    });

    test.each([
      ['.*', 0],
      ['(', 0],
      ['[a-z', 0],
      ['\\', 0],
      ['$', 0],
      ['+9650', 23],
      ['@example.com', 23],
    ])('treats %s as plain text, not as a pattern', async (text, expected) => {
      expect(await search(text)).toHaveLength(expected);
    });

    test('can be kept to one stage', async () => {
      const results = await search('+9650', '&stage=Lost');

      expect(idsOf(results)).toEqual(idsOf(seed.studentsInStage('Lost')));
    });

    test('can be kept to the students assigned to one member of staff', async () => {
      const results = await search('+9650', `&assignedUserId=${u.counsellorA._id}`);

      expect(results).toHaveLength(8);
    });

    test('a malformed assignedUserId is refused', async () => {
      await as(u.staff).get('/v1/students/search/x?assignedUserId=not-an-id').expect(httpStatus.BAD_REQUEST);
    });
  });

  describe('adding a student', () => {
    const body = (extra = {}) => ({
      firstName: 'Rana',
      lastName: 'Testwell',
      phoneNo: '+96509900001',
      email: 'new.student@example.com',
      editor: { id: String(u.counsellorA._id), name: u.counsellorA.name },
      ...extra,
    });

    test('staff add one: it starts at NotApplied, as theirs, with a reference of its own', async () => {
      const res = await as(u.counsellorA).post('/v1/students', body()).expect(httpStatus.CREATED);

      const stored = await inDb(res.body);
      expect(stored).toMatchObject({ firstName: 'Rana', lastName: 'Testwell', stage: 'NotApplied', qualified: false });
      expect(String(stored.createdBy)).toBe(String(u.counsellorA._id));
      expect(stored.refrenceNo).toMatch(/^\d{6}-000\d+$/);
      expect(await Students.countDocuments()).toBe(24);
    });

    test('staff can assign it as they add it', async () => {
      const assignedTo = [{ user: String(u.counsellorB._id), role: 'counsellor', userRole: String(u.counsellorB.role) }];

      const res = await as(u.counsellorA).post('/v1/students', body({ assignedTo })).expect(httpStatus.CREATED);

      const stored = await inDb(res.body);
      expect(stored.assignedTo).toHaveLength(1);
      expect(String(stored.assignedTo[0].user)).toBe(String(u.counsellorB._id));
    });

    test('whoever the request says made it, it is recorded as made by the caller', async () => {
      const res = await as(u.counsellorA)
        .post('/v1/students', body({ createdBy: String(u.admin._id) }))
        .expect(httpStatus.CREATED);

      expect(String((await inDb(res.body)).createdBy)).toBe(String(u.counsellorA._id));
    });

    test('a field the model does not have is not stored', async () => {
      const res = await as(u.counsellorA)
        .post('/v1/students', body({ notAField: 'x', isAdmin: true }))
        .expect(httpStatus.CREATED);

      const stored = await inDb(res.body);
      expect(stored).not.toHaveProperty('notAField');
      expect(stored).not.toHaveProperty('isAdmin');
    });

    test.each(['firstName', 'lastName', 'phoneNo'])('one without %s is refused and nothing is stored', async (field) => {
      const incomplete = body();
      delete incomplete[field];

      const res = await as(u.counsellorA).post('/v1/students', incomplete);

      expect(res.status).toBe(httpStatus.BAD_REQUEST);
      expect(await Students.countDocuments()).toBe(23);
    });
  });

  describe('changing a student', () => {
    const own = () => seed.studentsOwnedBy(u.counsellorA).find((s) => s.channel === 'direct' && s.stage === 'NotApplied');

    test('staff change the profile', async () => {
      await as(u.counsellorA)
        .patch(`/v1/students/${own()._id}`, { city: 'Seedville', gender: 'Others' })
        .expect(httpStatus.OK);

      expect(await inDb(own())).toMatchObject({ city: 'Seedville', gender: 'Others' });
    });

    test('a value the model does not allow is refused and nothing changes', async () => {
      const res = await as(u.counsellorA).patch(`/v1/students/${own()._id}`, { stage: 'Graduated' });

      expect(res.status).toBe(httpStatus.BAD_REQUEST);
      expect((await inDb(own())).stage).toBe('NotApplied');
    });

    test('a field the model does not have is not stored', async () => {
      await as(u.counsellorA).patch(`/v1/students/${own()._id}`, { notAField: 'x' }).expect(httpStatus.OK);

      expect(await inDb(own())).not.toHaveProperty('notAField');
    });

    test('a student that does not exist is 404', async () => {
      await as(u.counsellorA)
        .patch('/v1/students/5eed00030000000000ffffff', { city: 'Seedville' })
        .expect(httpStatus.NOT_FOUND);
      await as(u.counsellorA).get('/v1/students/5eed00030000000000ffffff').expect(httpStatus.NOT_FOUND);
    });

    describe('moving between stages stamps the dates', () => {
      test('to Applied, then Enrolled', async () => {
        await as(u.counsellorA).patch(`/v1/students/${own()._id}`, { stage: 'Applied' }).expect(httpStatus.OK);
        const applied = await inDb(own());
        expect(applied.appliedAt).toBeInstanceOf(Date);
        expect(applied.enrolledAt).toBeUndefined();

        await as(u.counsellorA).patch(`/v1/students/${own()._id}`, { stage: 'Enrolled' }).expect(httpStatus.OK);
        const enrolled = await inDb(own());
        expect(enrolled.enrolledAt).toBeInstanceOf(Date);
        expect(enrolled.appliedAt.getTime()).toBe(applied.appliedAt.getTime());
      });

      test('to Lost, and back out of it', async () => {
        await as(u.counsellorA)
          .patch(`/v1/students/${own()._id}`, { stage: 'Lost', lostReason: 'Seed reason' })
          .expect(httpStatus.OK);
        expect((await inDb(own())).lostAt).toBeInstanceOf(Date);

        await as(u.counsellorA).patch(`/v1/students/${own()._id}`, { stage: 'NotApplied' }).expect(httpStatus.OK);
        expect((await inDb(own())).lostAt).toBeUndefined();
      });
    });

    describe('assignment', () => {
      test('staff assign a second person in another slot', async () => {
        const assignedTo = [
          { user: String(u.counsellorA._id), role: 'counsellor', userRole: String(u.counsellorA.role) },
          { user: String(u.staff._id), role: 'sales', userRole: String(u.staff.role) },
        ];

        await as(u.counsellorA).patch(`/v1/students/${own()._id}`, { assignedTo }).expect(httpStatus.OK);

        const stored = await inDb(own());
        expect(stored.assignedTo.map((a) => [String(a.user), a.role])).toEqual([
          [String(u.counsellorA._id), 'counsellor'],
          [String(u.staff._id), 'sales'],
        ]);
        const theirs = await list(`assignedUserId=${u.staff._id}`);
        expect(idsOf(theirs.results)).toEqual([String(own()._id)]);
      });

      test('a slot with no name is refused', async () => {
        const res = await as(u.counsellorA).patch(`/v1/students/${own()._id}`, {
          assignedTo: [{ user: String(u.staff._id) }],
        });

        expect(res.status).toBe(httpStatus.BAD_REQUEST);
        expect((await inDb(own())).assignedTo).toHaveLength(1);
      });
    });

    test('staff delete a student', async () => {
      await as(u.counsellorA).delete(`/v1/students/${own()._id}`).expect(httpStatus.NO_CONTENT);

      expect(await inDb(own())).toBeNull();
      expect(await Students.countDocuments()).toBe(22);
    });
  });

  describe('a new journey', () => {
    const of = (owner, stage) =>
      seed.studentsOwnedBy(owner).find((s) => s.stage === stage && String(s.createdBy) === String(owner._id));

    test('a student who enrolled starts again: the old journey is kept and the new one is open', async () => {
      const enrolled = of(u.counsellorB, 'Enrolled');
      expect(enrolled.applications.length).toBeGreaterThan(0);

      await as(u.counsellorB)
        .post(`/v1/students/${enrolled._id}/new-journey`, {
          preference: { courseLevel: 'Postgraduate', intakeYear: '2027', budgetRange: 'not carried over' },
        })
        .expect(httpStatus.OK);

      const stored = await inDb(enrolled);
      expect(stored.stage).toBe('NotApplied');
      expect(stored.applications).toEqual([]);
      expect(stored.journeys).toHaveLength(1);
      expect(stored.journeys[0]).toMatchObject({ outcome: 'Enrolled' });
      expect(stored.journeys[0].applications.map(String).sort()).toEqual([...enrolled.applications].sort());
      expect(String(stored.journeys[0].openedBy)).toBe(String(u.counsellorB._id));
      expect(stored.preference).toMatchObject({ courseLevel: 'Postgraduate', intakeYear: '2027' });
      expect(stored.preference.budgetRange).toBeUndefined();
      expect(stored.progressedFrom).toMatchObject({ journeyIndex: 0 });
    });

    test('the journey that ended in a place remembers where', async () => {
      // Counsellor B's enrolled student holds the application that reached Done.
      const enrolled = of(u.counsellorB, 'Enrolled');
      const done = seed
        .applicationsOf(enrolled)
        .find((a) => a.portalApplicationStatus.applicationPhases.find((p) => p.isCurrent).status === 'Done');

      await as(u.counsellorB).post(`/v1/students/${enrolled._id}/new-journey`).expect(httpStatus.OK);

      const stored = await inDb(enrolled);
      expect(String(stored.journeys[0].enrolledApplication)).toBe(String(done._id));
      expect(stored.journeys[0].enrolledCourse).toBe(done.courseName);
    });

    test('a student who was lost starts again, with nothing to progress from', async () => {
      const lost = of(u.counsellorA, 'Lost');

      await as(u.counsellorA).post(`/v1/students/${lost._id}/new-journey`).expect(httpStatus.OK);

      const stored = await inDb(lost);
      expect(stored.stage).toBe('NotApplied');
      expect(stored.journeys[0].outcome).toBe('Lost');
      expect(stored.progressedFrom).toBeUndefined();
    });

    test.each(['NotApplied', 'Applied'])('cannot start while the current one is open (%s)', async (stage) => {
      const open = of(u.counsellorA, stage);

      await as(u.counsellorA).post(`/v1/students/${open._id}/new-journey`).expect(httpStatus.BAD_REQUEST);

      const stored = await inDb(open);
      expect(stored.stage).toBe(stage);
      expect(stored.journeys).toEqual([]);
    });

    test("a partner's new journey for their own student goes back to review", async () => {
      const enrolled = of(u.schoolA, 'Enrolled');

      await as(u.schoolA).post(`/v1/students/${enrolled._id}/new-journey`).expect(httpStatus.OK);

      const stored = await inDb(enrolled);
      expect(stored.stage).toBe('PendingReview');
      expect(stored.journeys).toHaveLength(1);
    });

    test("a partner cannot start one for somebody else's student", async () => {
      const notTheirs = of(u.schoolB, 'Enrolled');

      await as(u.schoolA).post(`/v1/students/${notTheirs._id}/new-journey`).expect(httpStatus.NOT_FOUND);
      await as(u.subAgentA).post(`/v1/students/${notTheirs._id}/new-journey`).expect(httpStatus.NOT_FOUND);

      expect((await inDb(notTheirs)).journeys).toEqual([]);
    });
  });

  describe('what the page offers to filter by', () => {
    test('lists the schools students came from', async () => {
      const res = await as(u.staff).get('/v1/students/facets').expect(httpStatus.OK);

      expect(res.body.schools).toEqual(['Seed School A', 'Seed School B']);
    });
  });

  describe('requests that cannot be right', () => {
    test('an e-mail address another student has is refused when adding', async () => {
      await as(u.counsellorA)
        .post('/v1/students', {
          firstName: 'Rana',
          lastName: 'Testwell',
          phoneNo: '+96509900001',
          email: seed.students[1].email,
        })
        .expect(httpStatus.BAD_REQUEST);

      expect(await Students.countDocuments()).toBe(23);
    });

    test('an id that is not an id is 404, not a server error', async () => {
      await as(u.counsellorA).get('/v1/students/not-an-id').expect(httpStatus.NOT_FOUND);
      await as(u.counsellorA).patch('/v1/students/not-an-id', { city: 'Seedville' }).expect(httpStatus.NOT_FOUND);
    });

    test('deleting a student that does not exist is 404', async () => {
      await as(u.counsellorA).delete('/v1/students/5eed00030000000000ffffff').expect(httpStatus.NOT_FOUND);
    });

    test('a stage that does not exist matches nobody', async () => {
      expect(await list('stage=Nowhere')).toMatchObject({ results: [], totalResults: 0 });
    });
  });

  describe('sharing a student with a school counsellor', () => {
    const staffs = () => seed.studentsOwnedBy(u.counsellorB).find((s) => s.channel === 'direct' && s.stage === 'Applied');
    const share = (by, body) => as(by).post(`/v1/students/${staffs()._id}/share`, body);

    test('records who it was shared with, once', async () => {
      const first = await share(u.counsellorB, {
        userId: String(u.schoolA._id),
        sharedBy: String(u.counsellorB._id),
      }).expect(httpStatus.OK);
      const second = await share(u.counsellorB, {
        userId: String(u.schoolA._id),
        sharedBy: String(u.counsellorB._id),
      }).expect(httpStatus.OK);

      expect(first.body.alreadyShared).toBe(false);
      expect(second.body.alreadyShared).toBe(true);
      const stored = await inDb(staffs());
      expect(stored.sharedWithCounselors).toHaveLength(1);
      expect(String(stored.sharedWithCounselors[0].user)).toBe(String(u.schoolA._id));
    });

    test('needs to be told who to share with', async () => {
      await share(u.counsellorB, {}).expect(httpStatus.BAD_REQUEST);

      expect((await inDb(staffs())).sharedWithCounselors).toEqual([]);
    });

    test('is for staff: a partner cannot share a student, even their own', async () => {
      const own = seed.studentsOwnedBy(u.schoolA)[0];

      await as(u.schoolA)
        .post(`/v1/students/${own._id}/share`, { userId: String(u.schoolB._id) })
        .expect(httpStatus.FORBIDDEN);

      expect((await inDb(own)).sharedWithCounselors).toEqual([]);
    });
  });

  // How things are today, not how they are meant to be. Neither of these lets
  // anybody see or change something they should not: they are things that do
  // not work as a person using the page would expect. When one is changed, its
  // test fails and is rewritten to say what is then true.
  describe('not as one would expect yet', () => {
    test('searching for a first name and family name together finds nobody', async () => {
      const student = seed.students[0];
      const search = async (text) =>
        (
          await as(u.staff)
            .get(`/v1/students/search/${encodeURIComponent(text)}?limit=100`)
            .expect(httpStatus.OK)
        ).body.results;

      // Each name on its own finds the student.
      expect(idsOf(await search(student.firstName))).toContain(String(student._id));
      expect(idsOf(await search(student.lastName))).toContain(String(student._id));
      // Together they do not: the whole-name match needs a middle name between them.
      expect(await search(`${student.firstName} ${student.lastName}`)).toEqual([]);

      await Students.updateOne({ _id: student._id }, { $set: { middleName: 'Seedmiddle' } });
      expect(await search(`${student.firstName} ${student.lastName}`)).toEqual([]);
      expect(idsOf(await search(`${student.firstName} Seedmiddle ${student.lastName}`))).toEqual([String(student._id)]);
    });

    test('a school counsellor a student is shared with still cannot open it', async () => {
      const shared = seed.studentsOwnedBy(u.counsellorB).find((s) => s.channel === 'direct' && s.stage === 'Applied');
      await as(u.counsellorB)
        .post(`/v1/students/${shared._id}/share`, { userId: String(u.schoolA._id) })
        .expect(httpStatus.OK);

      await as(u.schoolA).get(`/v1/students/${shared._id}`).expect(httpStatus.NOT_FOUND);
      const theirList = await as(u.schoolA).get('/v1/students?limit=100').expect(httpStatus.OK);
      expect(idsOf(theirList.body.results)).not.toContain(String(shared._id));
    });

    test('a student can be shared with someone who is not a school counsellor', async () => {
      const shared = seed.studentsOwnedBy(u.counsellorB).find((s) => s.channel === 'direct' && s.stage === 'Applied');

      await as(u.counsellorB)
        .post(`/v1/students/${shared._id}/share`, { userId: String(u.subAgentA._id) })
        .expect(httpStatus.OK);

      expect((await inDb(shared)).sharedWithCounselors).toHaveLength(1);
    });
  });

  test('none of this tried to reach anything outside the machine', () => {
    expect(blocked).toEqual([]);
  });
});
