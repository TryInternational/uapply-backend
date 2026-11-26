const request = require('supertest');
const httpStatus = require('http-status');
const app = require('../../src/app');
const responseCache = require('../../src/middlewares/responseCache');
const setupTestDB = require('../utils/setupTestDB');
const { Students, Fees } = require('../../src/models');
const { loadSeed } = require('../seed/loadSeed');
const { build, PHASES } = require('../factories');
const { accessTokenFor } = require('../fixtures/token.fixture');
const { blocked } = require('../utils/blockNetwork');

setupTestDB();

/**
 * The Stats tab's breakdowns (GET /v1/students/dashboard-breakdowns), and the
 * dashboard figures that depend on what day it is.
 *
 * The breakdowns say of each student whether they applied, reached an offer
 * and enrolled, and tally those by person, university and so on. Here the same
 * three questions are answered from the seed in plain JavaScript, by the
 * definitions written at the top of the service, and the two are compared.
 *
 * For the figures that depend on today, the date is fixed for the length of
 * the test. Only the date is: timers run as usual.
 */

const NOT_LIVE = ['DRAFT', 'SUBMITTED_BY_SUBAGENT', 'SUBMITTED_BY_COUNSELOR', 'REJECTED', 'RETURNED_FOR_EDIT'];
const OFFER = PHASES.indexOf('Conditional offer');
const EVERYTHING = `startDate=${encodeURIComponent('2025-01-01T00:00:00.000Z')}&endDate=${encodeURIComponent(
  '2026-12-31T23:59:59.999Z'
)}`;
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

// The id of a seed record, of a row in an answer, or of an id itself. (An
// ObjectId has an `id` of its own, its raw bytes, which is not what is wanted.)
const id = (record) => {
  if (record && record._id) return String(record._id);
  if (record && typeof record.id === 'string') return record.id;
  return String(record);
};
const at = (iso) => new Date(iso);
const insert = (Model, records) => Model.insertMany(records, { timestamps: false });
const tallied = (rows) => Object.fromEntries(rows.map((row) => [row.label, row.n]));

describe('the Stats tab', () => {
  let seed;
  let u;
  const as = (user) => ({
    get: (path) =>
      request(app)
        .get(path)
        .set('Authorization', `Bearer ${accessTokenFor(user)}`),
  });
  const breakdowns = async (query = EVERYTHING) => {
    const res = await as(u.staff).get(`/v1/students/dashboard-breakdowns?${query}`).expect(httpStatus.OK);
    return res.body;
  };
  const todayIs = (iso) => jest.useFakeTimers({ now: at(iso), doNotFake: ALL_BUT_THE_DATE });

  // The seed, read the way the service's definitions put it.
  const reached = (application) => {
    const phases = application.portalApplicationStatus.applicationPhases;
    const current = phases.find((p) => p.phaseState === 'AwaitingResponseStudent') || phases.find((p) => p.isCurrent);
    return PHASES.indexOf(current.status);
  };
  const live = () => seed.applications.filter((a) => !NOT_LIVE.includes(a.reviewStatus));
  const liveOf = (student) => live().filter((a) => id(a.studentId) === id(student));
  const enrolled = (student) => student.stage === 'Enrolled';
  const applied = (student) => enrolled(student) || liveOf(student).length > 0;
  const offered = (student) => enrolled(student) || liveOf(student).some((a) => !a.rejected && reached(a) >= OFFER);

  beforeEach(async () => {
    responseCache.clear();
    seed = await loadSeed();
    u = seed.users;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('student by student', () => {
    test('lists every student but the referrals that were turned down', async () => {
      const { analysis } = await breakdowns();

      expect(analysis.map(id).sort()).toEqual(
        seed.students
          .filter((s) => s.stage !== 'Denied')
          .map(id)
          .sort()
      );
    });

    test('says of each whether they applied, reached an offer and enrolled', async () => {
      const { analysis } = await breakdowns();

      analysis.forEach((row) => {
        const student = seed.students.find((s) => id(s) === row.id);
        expect({ id: row.id, applied: row.applied, offer: row.offer, enrolled: row.enrolled }).toEqual({
          id: row.id,
          applied: applied(student),
          offer: offered(student),
          enrolled: enrolled(student),
        });
      });
      expect(analysis.filter((row) => row.applied).length).toBeGreaterThan(0);
      expect(analysis.filter((row) => row.applied && !row.offer).length).toBeGreaterThan(0);
      expect(analysis.filter((row) => row.enrolled).length).toBeGreaterThan(0);
    });

    test('names the universities each applied to, and the channel they came by', async () => {
      const { analysis } = await breakdowns();
      const label = { subagent: 'Sub-agent', counselor: 'School counselor', lead: 'Online lead', direct: 'Walk-in' };

      analysis.forEach((row) => {
        const student = seed.students.find((s) => id(s) === row.id);
        const universities = [...new Set(liveOf(student).map((a) => a.institute.name))];
        expect([row.id, [...row.unis].sort(), row.channel]).toEqual([row.id, universities.sort(), label[student.channel]]);
      });
    });

    test('with no dates, is every student there is', async () => {
      const wide = await breakdowns();
      const always = await breakdowns('');

      expect(always.analysis.map(id).sort()).toEqual(wide.analysis.map(id).sort());
    });

    test('with dates, is the students added within them', async () => {
      const students = seed.students.filter((s) => s.stage !== 'Denied').sort((a, b) => a.createdAt - b.createdAt);
      const from = students[3].createdAt;
      const to = students[9].createdAt;
      const within = students.filter((s) => s.createdAt >= from && s.createdAt <= to);

      const { analysis } = await breakdowns(
        `startDate=${encodeURIComponent(from.toISOString())}&endDate=${encodeURIComponent(to.toISOString())}`
      );

      expect(within.length).toBeLessThan(students.length);
      expect(analysis.map(id).sort()).toEqual(within.map(id).sort());
    });
  });

  describe('by university', () => {
    test('offers and rejections are counted over the live applications made in the range', async () => {
      const expected = {};
      live().forEach((a) => {
        const row = expected[a.institute.name] || { applied: 0, offers: 0, rejected: 0 };
        row.applied += 1;
        if (a.rejected) row.rejected += 1;
        else if (reached(a) >= OFFER) row.offers += 1;
        expected[a.institute.name] = row;
      });

      const { offerRate } = await breakdowns();

      expect(
        Object.fromEntries(offerRate.map((r) => [r.label, { applied: r.applied, offers: r.offers, rejected: r.rejected }]))
      ).toEqual(expected);
      const decided = offerRate.map((r) => r.offers + r.rejected);
      expect(decided).toEqual([...decided].sort((a, b) => b - a));
    });
  });

  describe('by person', () => {
    const board = async (query = EVERYTHING) => {
      const res = await as(u.staff).get(`/v1/students/counselor-leaderboard?${query}`).expect(httpStatus.OK);
      return res.body;
    };

    test('the table and the Sales leaderboard give each person the same figures', async () => {
      const { people } = await breakdowns();
      const leaderboard = await board();
      const figures = (row) => ({ applied: row.applied, offers: row.offers, enrolled: row.enrolled });

      expect(people.sales.length).toBeGreaterThan(0);
      expect(Object.fromEntries(people.sales.map((row) => [row.userId, figures(row)]))).toEqual(
        Object.fromEntries(leaderboard.map((row) => [row.userId, figures(row)]))
      );
    });

    test('nobody has more offers or enrolments than students who applied', async () => {
      const { people } = await breakdowns();

      people.sales.forEach((row) => {
        expect(row.offers).toBeLessThanOrEqual(row.applied);
        expect(row.enrolled).toBeLessThanOrEqual(row.applied);
        expect(row.applied).toBeLessThanOrEqual(row.students);
      });
    });

    test('the rows are for the people the students are assigned to', async () => {
      const { people } = await breakdowns();
      const assigned = new Set(seed.students.flatMap((s) => s.assignedTo.map((a) => id(a.user))));

      people.sales.forEach((row) => expect(assigned.has(row.userId)).toBe(true));
      expect(people.am).toEqual([]);
      expect(people.ops).toEqual([]);
    });
  });

  describe('team rankings', () => {
    test('each row is a student with an application, at the furthest phase any of theirs has reached', async () => {
      const { team } = await breakdowns();

      expect(team.length).toBeGreaterThan(0);
      team.forEach((row) => {
        const student = seed.students.find((s) => id(s) === row.id);
        const furthest = Math.max(...liveOf(student).map(reached));
        expect([row.id, row.stageIdx, row.stage]).toEqual([row.id, furthest, PHASES[furthest]]);
        expect(row.sales).toEqual(student.assignedTo.map((a) => id(a.user)));
      });
    });

    test('a student who was lost or turned down is not ranked', async () => {
      const { team } = await breakdowns();
      const stages = team.map((row) => seed.students.find((s) => id(s) === row.id).stage);

      expect(stages.filter((stage) => ['Lost', 'Denied'].includes(stage))).toEqual([]);
    });
  });

  describe('the smaller tallies', () => {
    test('schools are the ones students came from, turned-down referrals left out', async () => {
      const expected = {};
      seed.students
        .filter((s) => s.stage !== 'Denied' && s.previousSchool)
        .forEach((s) => {
          expected[s.previousSchool] = (expected[s.previousSchool] || 0) + 1;
        });

      expect(tallied((await breakdowns()).schools)).toEqual(expected);
    });

    test('lost students are tallied by the reason given, by when they were lost', async () => {
      await insert(Students, [
        build.student({
          stage: 'Lost',
          lostReason: 'Chose another agency',
          createdAt: at('2024-01-10T09:00:00.000Z'),
          lostAt: at('2025-03-10T09:00:00.000Z'),
        }),
        build.student({
          stage: 'Lost',
          lostReason: 'Chose another agency',
          createdAt: at('2024-01-11T09:00:00.000Z'),
          lostAt: at('2025-03-11T09:00:00.000Z'),
        }),
        build.student({
          stage: 'Lost',
          lostReason: 'Could not afford it',
          createdAt: at('2024-01-12T09:00:00.000Z'),
          lostAt: at('2025-03-12T09:00:00.000Z'),
        }),
        build.student({
          stage: 'Lost',
          lostReason: 'Could not afford it',
          createdAt: at('2025-03-05T09:00:00.000Z'),
          lostAt: at('2025-05-01T09:00:00.000Z'),
        }),
      ]);
      const march = `startDate=${encodeURIComponent('2025-03-01T00:00:00.000Z')}&endDate=${encodeURIComponent(
        '2025-03-31T23:59:59.999Z'
      )}`;

      const { lostReasons } = await breakdowns(march);

      expect(lostReasons).toEqual([
        { label: 'Chose another agency', n: 2 },
        { label: 'Could not afford it', n: 1 },
      ]);
    });

    test('a student lost with no reason given is counted as such', async () => {
      const lost = seed.students.filter((s) => s.stage === 'Lost');

      const { lostReasons } = await breakdowns();

      expect(lost.length).toBeGreaterThan(0);
      expect(lostReasons).toEqual([{ label: 'No reason recorded', n: lost.length }]);
    });
  });

  describe('by intake', () => {
    test('the intakes on offer are the ones students are aiming at', async () => {
      const aiming = seed.students.filter((s) =>
        liveOf(s).some((a) => a.intakeMonth === 'September' && a.intakeYear === 2026)
      );

      const { intakes } = await breakdowns();

      expect(intakes).toEqual([{ label: 'September 2026', students: aiming.length }]);
    });

    test('picking one makes it the cohort, whatever the dates', async () => {
      const narrow = `startDate=${encodeURIComponent('2024-01-01T00:00:00.000Z')}&endDate=${encodeURIComponent(
        '2024-01-31T23:59:59.999Z'
      )}`;

      const picked = await breakdowns(`${narrow}&intake=${encodeURIComponent('September 2026')}`);
      const unpicked = await breakdowns(narrow);

      expect(picked.cohort).toEqual({ intake: 'September 2026' });
      expect(picked.analysis.length).toBe(picked.intakes[0].students);
      expect(picked.analysis.every((row) => row.intake === 'September 2026')).toBe(true);
      expect(unpicked.cohort).toMatchObject({ range: true });
      expect(unpicked.analysis).toEqual([]);
    });

    test('an intake that is not a month and a year is ignored', async () => {
      const res = await breakdowns(`${EVERYTHING}&intake=soon`);

      expect(res.cohort).toMatchObject({ range: true });
    });
  });

  describe('students who should have arrived', () => {
    // The seed has one student whose application is at CAS Received, for
    // September 2026, and who is not marked enrolled.
    const waiting = () => {
      const application = live().find((a) => PHASES[reached(a)] === 'CAS Received');
      return { application, student: seed.students.find((s) => id(s) === id(application.studentId)) };
    };

    test('are not listed before their intake has started', async () => {
      todayIs('2026-08-31T09:00:00.000Z');

      expect((await breakdowns()).arrivals).toEqual([]);
    });

    test('are listed once it has, with the application to confirm', async () => {
      todayIs('2026-09-02T09:00:00.000Z');
      const { application, student } = waiting();

      const { arrivals } = await breakdowns();

      expect(arrivals).toHaveLength(1);
      expect(arrivals[0]).toMatchObject({
        studentId: id(student),
        applicationId: id(application),
        uni: application.institute.name,
        intake: 'September 2026',
        stage: 'CAS Received',
        sales: student.assignedTo.map((a) => id(a.user)),
      });
    });

    test('are not listed once they are marked enrolled', async () => {
      todayIs('2026-09-02T09:00:00.000Z');
      await Students.updateOne(
        { _id: waiting().student._id },
        { $set: { stage: 'Enrolled', enrolledAt: at('2026-09-01T09:00:00.000Z') } }
      );

      expect((await breakdowns()).arrivals).toEqual([]);
    });
  });

  describe('money taken so far this month', () => {
    const june = 'startDate=2025-06-01&endDate=2025-06-30';
    const officeFeesInJune = async () => {
      const res = await as(u.staff).get(`/v1/fees/fees-dashboard-data?${june}`).expect(httpStatus.OK);
      return res.body.amounts.find((row) => row.feeType === 'office-fees' && row.year === 2025 && row.month === 6);
    };

    beforeEach(async () => {
      await insert(Fees, [
        build.fee({ feeType: 'office-fees', createdDate: at('2025-06-01T12:00:00.000Z'), tag: { amount: 50 } }),
        build.fee({ feeType: 'office-fees', createdDate: at('2025-06-16T12:00:00.000Z'), tag: { amount: 30 } }),
        build.fee({ feeType: 'office-fees', createdDate: at('2025-06-20T12:00:00.000Z'), tag: { amount: 10 } }),
      ]);
    });

    test('is each month up to the same day of the month as today', async () => {
      todayIs('2025-07-16T09:00:00.000Z');

      expect(await officeFeesInJune()).toMatchObject({ totalAmount: 90, bookingCount: 3, amountToDay: 80, countToDay: 2 });
    });

    test('on the last day of a month is the whole of every month', async () => {
      todayIs('2025-07-31T09:00:00.000Z');

      expect(await officeFeesInJune()).toMatchObject({ totalAmount: 90, amountToDay: 90, countToDay: 3 });
    });

    test('goes by the day in Kuwait: at 22:00 UTC on the 15th it is already the 16th there', async () => {
      todayIs('2025-07-15T22:00:00.000Z');

      expect(await officeFeesInJune()).toMatchObject({ amountToDay: 80, countToDay: 2 });
    });
  });

  // How things are today, written down so a change shows up. It does not let
  // anybody see or change what they should not. When it is changed, the test
  // fails and is rewritten to say what is then true.
  describe('not as one would expect yet', () => {
    test('dates that are not dates are ignored, where the students dashboard refuses them', async () => {
      const res = await as(u.staff)
        .get('/v1/students/dashboard-breakdowns?startDate=soon&endDate=later')
        .expect(httpStatus.OK);

      expect(res.body.analysis.length).toBe(seed.students.filter((s) => s.stage !== 'Denied').length);
      await as(u.staff)
        .get('/v1/students/student-dashboard-data?startDate=soon&endDate=later')
        .expect(httpStatus.BAD_REQUEST);
    });
  });

  test('none of this tried to reach anything outside the machine', () => {
    expect(blocked).toEqual([]);
  });
});
