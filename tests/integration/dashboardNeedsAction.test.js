const request = require('supertest');
const httpStatus = require('http-status');
const app = require('../../src/app');
const responseCache = require('../../src/middlewares/responseCache');
const setupTestDB = require('../utils/setupTestDB');
const { Application, Students, Comments, Activity, Fees } = require('../../src/models');
const { loadSeed } = require('../seed/loadSeed');
const { build, phasesUpTo } = require('../factories');
const { accessTokenFor } = require('../fixtures/token.fixture');
const { blocked } = require('../utils/blockNetwork');

setupTestDB();

/**
 * The parts of the dashboards that say what needs doing, and how this year
 * compares with last:
 *
 *   - the two lists of students under "needs action": dormant for 30 days or
 *     more, and IELTS not booked;
 *   - the applications the overdue count weighs;
 *   - students who applied, month by month, this year and last;
 *   - applications made and enrolled this year, month by month.
 *
 * All of them depend on what day it is, so each test says what today is. Only
 * the date is set; timers run as usual.
 *
 * Most tests add a few records of their own and look for those in the answer.
 * Where a figure is a count, the test asks before and after adding its records
 * and compares the difference, so it does not depend on what the seed holds.
 */

const ALL_BUT_THE_DATE = [
  'hrtime',
  'nextTick',
  'performance',
  'queueMicrotask',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'requestIdleCallback',
  'cancelIdleCallback',
  'setImmediate',
  'clearImmediate',
  'setInterval',
  'clearInterval',
  'setTimeout',
  'clearTimeout',
];

const DAY = 24 * 60 * 60 * 1000;
const at = (iso) => new Date(iso);
const idOf = (record) => String(record._id || record.id || record);
const insert = (Model, records) => Model.insertMany(records, { timestamps: false });

describe('what needs action, and this year against last', () => {
  let seed;
  let u;
  const as = (user) => ({
    get: (path) =>
      request(app)
        .get(path)
        .set('Authorization', `Bearer ${accessTokenFor(user)}`),
    put: (path, body) =>
      request(app)
        .put(path)
        .set('Authorization', `Bearer ${accessTokenFor(user)}`)
        .send(body),
  });
  const todayIs = (iso) => jest.useFakeTimers({ now: at(iso), doNotFake: ALL_BUT_THE_DATE });
  const daysAgo = (days) => new Date(Date.now() - days * DAY);
  const drilldown = async (metric) => {
    const res = await as(u.staff).get(`/v1/application/dashboard-drilldown?metric=${metric}`).expect(httpStatus.OK);
    return res.body;
  };
  const rowFor = (rows, student) => rows.find((row) => row.studentId === idOf(student));

  beforeEach(async () => {
    responseCache.clear();
    seed = await loadSeed();
    u = seed.users;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('dormant students', () => {
    // A student last touched so many days ago, and nothing else recorded.
    const quiet = (days, overrides = {}) =>
      build.student({ createdAt: daysAgo(days + 30), updatedAt: daysAgo(days), ...overrides });

    beforeEach(() => todayIs('2026-03-01T09:00:00.000Z'));

    test('are students not applied yet, or applied, with nothing recorded for 30 days or more', async () => {
      const notApplied = quiet(40);
      const applied = quiet(30, { stage: 'Applied' });
      const recent = quiet(29);
      const enrolled = quiet(90, { stage: 'Enrolled' });
      const lost = quiet(90, { stage: 'Lost' });
      const waiting = quiet(90, { stage: 'PendingReview' });
      await insert(Students, [notApplied, applied, recent, enrolled, lost, waiting]);

      const rows = await drilldown('dormant');

      expect(rowFor(rows, notApplied)).toMatchObject({
        quietDays: 40,
        stage: 'Not applied yet',
        studentStage: 'NotApplied',
      });
      expect(rowFor(rows, applied)).toMatchObject({ quietDays: 30, stage: 'Applied' });
      [recent, enrolled, lost, waiting].forEach((student) => expect(rowFor(rows, student)).toBeUndefined());
      // and nobody else's row breaks the rule either
      rows.forEach((row) => {
        expect(['NotApplied', 'Applied']).toContain(row.studentStage);
        expect(row.quietDays).toBeGreaterThanOrEqual(30);
      });
    });

    test('a comment, a timeline entry or a change to an application is something recorded', async () => {
      const commented = quiet(90);
      const logged = quiet(90);
      const moved = quiet(90, { stage: 'Applied' });
      const untouched = quiet(90);
      await insert(Students, [commented, logged, moved, untouched]);
      await insert(Comments, [build.comment({ studentId: commented._id, author: u.counsellorA, dateTime: daysAgo(5) })]);
      await insert(Activity, [
        {
          student: logged._id,
          type: 'stage',
          text: 'Seed entry, written for a test.',
          createdAt: daysAgo(3),
          updatedAt: daysAgo(3),
        },
      ]);
      await insert(Application, [
        build.application({ studentId: moved._id, createdAt: daysAgo(80), updatedAt: daysAgo(10) }),
      ]);

      const rows = await drilldown('dormant');

      [commented, logged, moved].forEach((student) => expect(rowFor(rows, student)).toBeUndefined());
      expect(rowFor(rows, untouched)).toMatchObject({ quietDays: 90 });
    });

    test('the quiet is counted from the latest of them', async () => {
      const student = quiet(90, { stage: 'Applied' });
      await insert(Students, [student]);
      await insert(Comments, [build.comment({ studentId: student._id, author: u.counsellorA, dateTime: daysAgo(60) })]);
      await insert(Application, [
        build.application({ studentId: student._id, createdAt: daysAgo(80), updatedAt: daysAgo(45) }),
      ]);

      const row = rowFor(await drilldown('dormant'), student);

      expect(row.quietDays).toBe(45);
      expect(at(row.lastActivityAt).getTime()).toBe(daysAgo(45).getTime());
    });

    test('the longest quiet comes first', async () => {
      await insert(Students, [quiet(35), quiet(400), quiet(120)]);

      const days = (await drilldown('dormant')).map((row) => row.quietDays);

      expect(days[0]).toBeGreaterThanOrEqual(400);
      expect(days).toEqual([...days].sort((a, b) => b - a));
    });

    test('each row says who the student is, who looks after them and what they last applied for', async () => {
      const student = quiet(50, {
        stage: 'Applied',
        assignedTo: [
          { user: u.counsellorA._id, role: 'sales' },
          { user: u.counsellorB._id, role: 'accountManager' },
        ],
        preference: { intakeMonth: 'January', intakeYear: '2027' },
      });
      await insert(Students, [student]);
      await insert(Application, [
        build.application({
          studentId: student._id,
          createdAt: daysAgo(80),
          updatedAt: daysAgo(70),
          courseName: 'Older course',
        }),
        build.application({
          studentId: student._id,
          createdAt: daysAgo(75),
          updatedAt: daysAgo(50),
          courseName: 'Latest course',
          institute: { name: 'Seed University 1' },
        }),
      ]);

      const row = rowFor(await drilldown('dormant'), student);

      expect(row).toMatchObject({
        kind: 'student',
        studentName: `${student.firstName} ${student.lastName}`,
        applications: 2,
        courseName: 'Latest course',
        institute: { name: 'Seed University 1' },
        intakeMonth: 'January',
        intakeYear: '2027',
      });
      expect([...row.counselors].sort()).toEqual([u.counsellorA.name, u.counsellorB.name].sort());
    });

    test('what a partner sent in and nobody has approved does not count as something recorded', async () => {
      const student = quiet(60);
      await insert(Students, [student]);
      await insert(Application, [
        build.application({
          studentId: student._id,
          reviewStatus: 'SUBMITTED_BY_SUBAGENT',
          createdAt: daysAgo(5),
          updatedAt: daysAgo(5),
        }),
      ]);

      const row = rowFor(await drilldown('dormant'), student);

      expect(row).toMatchObject({ quietDays: 60, applications: 0 });
    });
  });

  describe('IELTS not booked', () => {
    // An applied student for an intake that has not begun, with no test and no booking.
    const applicant = (overrides = {}) =>
      build.student({ stage: 'Applied', preference: { intakeMonth: 'September', intakeYear: '2026' }, ...overrides });

    beforeEach(() => todayIs('2026-03-10T09:00:00.000Z'));

    test('are applied students with no English test on file and no booking, whose intake has not begun', async () => {
      const due = applicant();
      const notApplied = applicant({ stage: 'NotApplied' });
      const enrolled = applicant({ stage: 'Enrolled' });
      await insert(Students, [due, notApplied, enrolled]);

      const rows = await drilldown('ielts');

      expect(rowFor(rows, due)).toMatchObject({
        kind: 'student',
        stage: 'Applied',
        intakeMonth: 'September',
        intakeYear: '2026',
      });
      expect(rowFor(rows, notApplied)).toBeUndefined();
      expect(rowFor(rows, enrolled)).toBeUndefined();
      rows.forEach((row) => expect(row.studentStage).toBe('Applied'));
    });

    test('a test taken, awaited or scored takes a student off the list', async () => {
      const taken = applicant({ testTaken: 'Yes' });
      const awaited = applicant({ testTaken: 'Waiting for results' });
      const scored = applicant({ testScore: '6.5' });
      const read = applicant({ englishTest: { overall: '7.0' } });
      const notTaken = applicant({ testTaken: 'No' });
      await insert(Students, [taken, awaited, scored, read, notTaken]);

      const rows = await drilldown('ielts');

      [taken, awaited, scored, read].forEach((student) => expect(rowFor(rows, student)).toBeUndefined());
      expect(rowFor(rows, notTaken)).toBeDefined();
    });

    test('so does a booking, whether it names the student by link or only by name', async () => {
      const linked = applicant();
      const named = applicant();
      const namedInFull = applicant({ middleName: 'Seedmiddle' });
      const somebodyElse = applicant();
      await insert(Students, [linked, named, namedInFull, somebodyElse]);
      await insert(Fees, [
        build.fee({ feeType: 'ielts-booking', student: linked._id }),
        build.fee({
          feeType: 'ielts-booking',
          tag: { fullName: `  ${named.firstName}   ${named.lastName.toUpperCase()} ` },
        }),
        build.fee({
          feeType: 'ielts-booking',
          tag: { fullName: `${namedInFull.firstName} Seedmiddle ${namedInFull.lastName}` },
        }),
        // a fee of another kind is not a booking
        build.fee({ feeType: 'office-fees', student: somebodyElse._id }),
      ]);

      const rows = await drilldown('ielts');

      [linked, named, namedInFull].forEach((student) => expect(rowFor(rows, student)).toBeUndefined());
      expect(rowFor(rows, somebodyElse)).toBeDefined();
    });

    test('an intake that has begun, this month included, is past booking a test; one not recorded stays on', async () => {
      const begun = applicant({ preference: { intakeMonth: 'January', intakeYear: '2026' } });
      const thisMonth = applicant({ preference: { intakeMonth: 'March', intakeYear: '2026' } });
      const nextMonth = applicant({ preference: { intakeMonth: 'April', intakeYear: '2026' } });
      const unknown = applicant({ preference: {} });
      await insert(Students, [begun, thisMonth, nextMonth, unknown]);

      const rows = await drilldown('ielts');

      expect(rowFor(rows, begun)).toBeUndefined();
      expect(rowFor(rows, thisMonth)).toBeUndefined();
      expect(rowFor(rows, nextMonth)).toBeDefined();
      expect(rowFor(rows, unknown)).toBeDefined();
    });

    test("with no intake of the student's own, the intake of their application is used", async () => {
      const student = applicant({ preference: {} });
      await insert(Students, [student]);
      await insert(Application, [build.application({ studentId: student._id, intakeMonth: 'May', intakeYear: 2026 })]);

      const row = rowFor(await drilldown('ielts'), student);

      expect(row).toMatchObject({ intakeMonth: 'May', intakeYear: 2026, applications: 1 });
    });

    test('the soonest intake comes first, and a student with none recorded comes last', async () => {
      const autumn = applicant({ preference: { intakeMonth: 'September', intakeYear: '2026' } });
      const spring = applicant({ preference: { intakeMonth: 'April', intakeYear: '2026' } });
      const nextYear = applicant({ preference: { intakeMonth: 'January', intakeYear: '2027' } });
      const unknown = applicant({ preference: {} });
      await insert(Students, [autumn, unknown, nextYear, spring]);

      const rows = await drilldown('ielts');
      const place = (student) => rows.findIndex((row) => row.studentId === idOf(student));

      expect(place(spring)).toBeLessThan(place(autumn));
      expect(place(autumn)).toBeLessThan(place(nextYear));
      expect(place(nextYear)).toBeLessThan(place(unknown));
    });
  });

  describe('the applications the overdue count weighs', () => {
    const candidates = async () => {
      const res = await as(u.staff).get('/v1/application/application-dashboard-data').expect(httpStatus.OK);
      return res.body.applicationsData.overdueCandidates;
    };
    const rowOf = (rows, application) => rows.find((row) => String(row._id) === idOf(application));
    // An applied student and their application, for an intake that has not begun.
    const waitingAt = (phase, studentOverrides = {}, applicationOverrides = {}) => {
      const student = build.student({ stage: 'Applied', ...studentOverrides });
      const application = build.application({
        studentId: student._id,
        phase,
        intakeMonth: 'September',
        intakeYear: 2026,
        ...applicationOverrides,
      });
      return { student, application };
    };
    const insertAll = async (pairs) => {
      await insert(
        Students,
        pairs.map((pair) => pair.student)
      );
      await insert(
        Application,
        pairs.map((pair) => pair.application)
      );
    };

    beforeEach(() => todayIs('2026-03-10T09:00:00.000Z'));

    test('are the ones waiting at a phase that has a time allowance: as shipped, Initiated and Submitted', async () => {
      const initiated = waitingAt('Initiated');
      const submitted = waitingAt('Submitted');
      const offer = waitingAt('Conditional offer');
      const cas = waitingAt('CAS Received');
      await insertAll([initiated, submitted, offer, cas]);

      const rows = await candidates();

      expect(rowOf(rows, initiated.application)).toMatchObject({ stage: 'Initiated' });
      expect(rowOf(rows, submitted.application)).toMatchObject({ stage: 'Submitted' });
      expect(rowOf(rows, offer.application)).toBeUndefined();
      expect(rowOf(rows, cas.application)).toBeUndefined();
      rows.forEach((row) => expect(['Initiated', 'Submitted']).toContain(row.stage));
    });

    test('a phase an admin gives an allowance to joins them', async () => {
      const offer = waitingAt('Conditional offer');
      await insertAll([offer]);
      expect(rowOf(await candidates(), offer.application)).toBeUndefined();

      await as(u.admin)
        .put('/v1/sla-settings', {
          phases: [
            { status: 'Initiated', value: 4, unit: 'hours' },
            { status: 'Submitted', value: 20, unit: 'days' },
            { status: 'Conditional offer', value: 14, unit: 'days' },
          ],
        })
        .expect(httpStatus.OK);
      responseCache.clear();

      expect(rowOf(await candidates(), offer.application)).toMatchObject({ stage: 'Conditional offer' });
    });

    test('nobody is chasing an application that was rejected, or whose student is lost, denied or enrolled', async () => {
      const rejected = waitingAt('Submitted', {}, { rejected: true });
      const lost = waitingAt('Submitted', { stage: 'Lost' });
      const denied = waitingAt('Submitted', { stage: 'Denied' });
      const enrolled = waitingAt('Submitted', { stage: 'Enrolled' });
      const notReviewed = waitingAt('Submitted', {}, { reviewStatus: 'SUBMITTED_BY_SUBAGENT' });
      const live = waitingAt('Submitted');
      await insertAll([rejected, lost, denied, enrolled, notReviewed, live]);

      const rows = await candidates();

      [rejected, lost, denied, enrolled, notReviewed].forEach((pair) =>
        expect(rowOf(rows, pair.application)).toBeUndefined()
      );
      expect(rowOf(rows, live.application)).toBeDefined();
    });

    test('an application for an intake that has begun is left out; one with no intake at all stays in', async () => {
      const begun = waitingAt('Submitted', {}, { intakeMonth: 'January', intakeYear: 2026 });
      const thisMonth = waitingAt('Submitted', {}, { intakeMonth: 'March', intakeYear: 2026 });
      const ahead = waitingAt('Submitted', {}, { intakeMonth: 'April', intakeYear: 2026 });
      const byStudent = waitingAt(
        'Submitted',
        { preference: { intakeMonth: 'January', intakeYear: '2026' } },
        { intakeMonth: undefined, intakeYear: undefined }
      );
      const unknown = waitingAt('Submitted', {}, { intakeMonth: undefined, intakeYear: undefined });
      await insertAll([begun, thisMonth, ahead, byStudent, unknown]);

      const rows = await candidates();

      expect(rowOf(rows, begun.application)).toBeUndefined();
      expect(rowOf(rows, thisMonth.application)).toBeUndefined();
      expect(rowOf(rows, byStudent.application)).toBeUndefined();
      expect(rowOf(rows, ahead.application)).toBeDefined();
      expect(rowOf(rows, unknown.application)).toBeDefined();
    });

    test('each row carries what the clock is read from, and whose application it is', async () => {
      const startedAt = at('2026-02-01T08:00:00.000Z');
      const pair = waitingAt(
        'Submitted',
        { assignedTo: [{ user: u.counsellorA._id, role: 'sales' }], channel: 'referral' },
        { createdAt: startedAt, updatedAt: startedAt, institute: { name: 'Seed University 1' } }
      );
      await insertAll([pair]);

      const row = rowOf(await candidates(), pair.application);

      expect(row).toMatchObject({
        stage: 'Submitted',
        studentId: idOf(pair.student),
        studentName: `${pair.student.firstName} ${pair.student.lastName}`,
        channel: 'referral',
        counselors: [u.counsellorA.name],
        courseLevel: 'Undergraduate',
        institute: { name: 'Seed University 1' },
      });
      // when it entered the phase it is waiting at: a week after it was made, as the factory dates phases
      const waiting = row.portalApplicationStatus.applicationPhases.find((p) => p.phaseState === 'AwaitingResponseStudent');
      expect(waiting.status).toBe('Submitted');
      expect(at(waiting.createdDate).getTime()).toBe(startedAt.getTime() + 7 * DAY);
    });
  });

  describe('students who applied, month by month', () => {
    const applied = async (query = '') => {
      responseCache.clear();
      const res = await as(u.staff).get(`/v1/application/applied-students${query}`).expect(httpStatus.OK);
      return res.body;
    };
    // What adding records changed, month by month (January first).
    const gained = (before, after, series) => after.byMonth[series].map((n, month) => n - before.byMonth[series][month]);
    const months = (counts) => Array.from({ length: 12 }, (_, month) => counts[month + 1] || 0);
    const student = (overrides = {}) => build.student({ stage: 'Applied', appliedAt: undefined, ...overrides });
    const applicationFor = (aStudent, madeAt, overrides = {}) =>
      build.application({ studentId: aStudent._id, createdAt: at(madeAt), updatedAt: at(madeAt), ...overrides });

    beforeEach(() => todayIs('2026-06-10T09:00:00.000Z'));

    test("the answer is this year, last year, and last year up to today's day of the month", async () => {
      const answer = await applied();

      expect(answer.byMonth.year).toBe(2026);
      ['thisYear', 'lastYear', 'lastYearToDay'].forEach((series) => expect(answer.byMonth[series]).toHaveLength(12));
      expect(answer.count).toBeNull();
    });

    test('a student counts once for each intake applied for, in the month of the first application for it', async () => {
      const before = await applied();
      const aStudent = student();
      await insert(Students, [aStudent]);
      await insert(Application, [
        applicationFor(aStudent, '2026-02-10T09:00:00.000Z', { intakeMonth: 'September', intakeYear: 2026 }),
        applicationFor(aStudent, '2026-03-05T09:00:00.000Z', { intakeMonth: 'September', intakeYear: 2026 }),
        applicationFor(aStudent, '2026-04-02T09:00:00.000Z', { intakeMonth: 'January', intakeYear: 2027 }),
      ]);

      const after = await applied();

      expect(gained(before, after, 'thisYear')).toEqual(months({ 2: 1, 4: 1 }));
    });

    test('the month is the month in Kuwait', async () => {
      const before = await applied();
      const aStudent = student();
      await insert(Students, [aStudent]);
      // half past midnight on 1 May in Kuwait, which is still 30 April in UTC
      await insert(Application, [applicationFor(aStudent, '2026-04-30T21:30:00.000Z')]);

      const after = await applied();

      expect(gained(before, after, 'thisYear')).toEqual(months({ 5: 1 }));
    });

    test('a student marked applied with no application counts once, when they were marked', async () => {
      const before = await applied();
      await insert(Students, [student({ appliedAt: at('2026-01-20T09:00:00.000Z') })]);

      const after = await applied();

      expect(gained(before, after, 'thisYear')).toEqual(months({ 1: 1 }));
    });

    test('an application prepared for a student who has not applied yet is not counted; nor one nobody has approved', async () => {
      const before = await applied();
      const notYet = student({ stage: 'NotApplied' });
      const fromPartner = student({ stage: 'PendingReview' });
      await insert(Students, [notYet, fromPartner]);
      await insert(Application, [
        applicationFor(notYet, '2026-02-10T09:00:00.000Z'),
        applicationFor(fromPartner, '2026-02-11T09:00:00.000Z', { reviewStatus: 'SUBMITTED_BY_SUBAGENT' }),
      ]);

      const after = await applied();

      expect(gained(before, after, 'thisYear')).toEqual(months({}));
    });

    test("last year is counted whole, and again up to today's day of the month", async () => {
      const before = await applied();
      const early = student();
      const late = student();
      await insert(Students, [early, late]);
      await insert(Application, [
        applicationFor(early, '2025-06-05T09:00:00.000Z', { intakeMonth: 'September', intakeYear: 2025 }),
        applicationFor(late, '2025-06-20T09:00:00.000Z', { intakeMonth: 'September', intakeYear: 2025 }),
      ]);

      const after = await applied();

      // today is the 10th
      expect(gained(before, after, 'lastYear')).toEqual(months({ 6: 2 }));
      expect(gained(before, after, 'lastYearToDay')).toEqual(months({ 6: 1 }));
      expect(gained(before, after, 'thisYear')).toEqual(months({}));
    });

    test('asked for another year, the answer is that year and the one before it', async () => {
      const aStudent = student();
      await insert(Students, [aStudent]);
      await insert(Application, [applicationFor(aStudent, '2024-08-15T09:00:00.000Z', { intakeYear: 2025 })]);

      const answer = await applied('?year=2025');

      expect(answer.byMonth.year).toBe(2025);
      expect(answer.byMonth.lastYear[7]).toBeGreaterThanOrEqual(1);
    });

    test('with two dates, the count is the times somebody applied between them', async () => {
      const range = `?startDate=${encodeURIComponent('2026-02-01T00:00:00.000Z')}&endDate=${encodeURIComponent(
        '2026-02-28T23:59:59.999Z'
      )}`;
      const before = await applied(range);
      const inside = student();
      const outside = student();
      await insert(Students, [inside, outside]);
      await insert(Application, [
        applicationFor(inside, '2026-02-10T09:00:00.000Z', { intakeMonth: 'September', intakeYear: 2026 }),
        applicationFor(inside, '2026-02-12T09:00:00.000Z', { intakeMonth: 'January', intakeYear: 2027 }),
        applicationFor(outside, '2026-03-01T09:00:00.000Z'),
      ]);

      const after = await applied(range);

      expect(after.count - before.count).toBe(2);
    });
  });

  describe('applications made and enrolled this year, month by month', () => {
    const made = async (query = '') =>
      (await as(u.staff).get(`/v1/application/count-by-month${query}`).expect(httpStatus.OK)).body;
    const enrolled = async (query = '') =>
      (await as(u.staff).get(`/v1/application/enrolled-count-by-month${query}`).expect(httpStatus.OK)).body;
    const gained = (before, after, field) => after.map((row, month) => row[field] - before[month][field]);
    const months = (counts) => Array.from({ length: 12 }, (_, month) => counts[month + 1] || 0);
    const applicationMade = (madeAt, overrides = {}) =>
      build.application({ studentId: seed.students[0]._id, createdAt: at(madeAt), updatedAt: at(madeAt), ...overrides });
    // The last phase itself completed: what is stored when "Done" is completed
    // without the marker being held on it.
    const finished = (madeAt) => ({
      applicationPhases: phasesUpTo('Done', at(madeAt)).map((phase) => ({
        ...phase,
        phaseState: 'Completed',
        isCurrent: false,
        isPrevious: phase.status === 'Done',
      })),
    });

    beforeEach(() => todayIs('2026-06-10T09:00:00.000Z'));

    test('both answer with a row for every month of this year', async () => {
      const expected = Array.from({ length: 12 }, (_, month) => ({ year: 2026, month: month + 1 }));

      expect(await made()).toMatchObject(expected);
      expect(await enrolled()).toMatchObject(expected);
    });

    test("applications are counted in the month they were made, and only this year's and only live ones", async () => {
      const before = await made();
      await insert(Application, [
        applicationMade('2026-02-10T09:00:00.000Z'),
        applicationMade('2026-02-20T09:00:00.000Z'),
        applicationMade('2026-05-15T09:00:00.000Z', { phase: 'Done' }),
        applicationMade('2025-05-15T09:00:00.000Z'),
        applicationMade('2026-05-16T09:00:00.000Z', { reviewStatus: 'SUBMITTED_BY_SUBAGENT' }),
      ]);

      expect(gained(before, await made(), 'bookingCount')).toEqual(months({ 2: 2, 5: 1 }));
    });

    test('enrolled ones are those whose last phase is completed, in the month the application was made', async () => {
      const before = await enrolled();
      await insert(Application, [
        applicationMade('2026-03-10T09:00:00.000Z', { portalApplicationStatus: finished('2026-03-10T09:00:00.000Z') }),
        applicationMade('2026-03-12T09:00:00.000Z', { phase: 'CAS Received' }),
        applicationMade('2025-03-10T09:00:00.000Z', { portalApplicationStatus: finished('2025-03-10T09:00:00.000Z') }),
        applicationMade('2026-03-14T09:00:00.000Z', {
          portalApplicationStatus: finished('2026-03-14T09:00:00.000Z'),
          reviewStatus: 'REJECTED',
        }),
      ]);

      expect(gained(before, await enrolled(), 'count')).toEqual(months({ 3: 1 }));
    });

    test('with an intake, only applications for that intake are counted', async () => {
      const intake = '?intakeMonth=January&intakeYear=2027';
      const beforeMade = await made(intake);
      const beforeEnrolled = await enrolled(intake);
      const done = { portalApplicationStatus: finished('2026-04-10T09:00:00.000Z') };
      await insert(Application, [
        applicationMade('2026-04-10T09:00:00.000Z', { intakeMonth: 'January', intakeYear: 2027, ...done }),
        applicationMade('2026-04-11T09:00:00.000Z', { intakeMonth: 'September', intakeYear: 2026, ...done }),
      ]);

      expect(gained(beforeMade, await made(intake), 'bookingCount')).toEqual(months({ 4: 1 }));
      expect(gained(beforeEnrolled, await enrolled(intake), 'count')).toEqual(months({ 4: 1 }));
    });

    // How things are today, not how they are meant to be. When this is
    // changed, the test fails and is rewritten to say what is then true.
    describe('not as one would expect yet', () => {
      // The student's profile enrols by putting the marker on the last phase
      // and asking the server to leave it there. The student is moved to
      // Enrolled, and the application waits at "Done" without being completed.
      test('an application enrolled with the marker held on the last phase is not in the enrolled count', async () => {
        const student = build.student({ stage: 'Applied' });
        const application = build.application({
          studentId: student._id,
          phase: 'CAS Received',
          createdAt: at('2026-05-05T09:00:00.000Z'),
          updatedAt: at('2026-05-05T09:00:00.000Z'),
          institute: { name: 'Seed University 1' },
        });
        await insert(Students, [student]);
        await insert(Application, [application]);
        const before = await enrolled();

        await request(app)
          .patch(`/v1/application/${application._id}`)
          .set('Authorization', `Bearer ${accessTokenFor(u.counsellorA)}`)
          .send({
            phaseChanged: true,
            holdPhase: true,
            portalApplicationStatus: { applicationPhases: phasesUpTo('Done', application.createdAt) },
          })
          .expect(httpStatus.OK);

        expect((await Students.findById(student._id).lean()).stage).toBe('Enrolled');
        expect(gained(before, await enrolled(), 'count')).toEqual(months({}));
      });
    });
  });

  test('none of this tried to reach anything outside the machine', () => {
    expect(blocked).toEqual([]);
  });
});
