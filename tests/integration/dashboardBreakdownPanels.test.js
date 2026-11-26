const request = require('supertest');
const httpStatus = require('http-status');
const app = require('../../src/app');
const responseCache = require('../../src/middlewares/responseCache');
const setupTestDB = require('../utils/setupTestDB');
const { Students, Application, Courses } = require('../../src/models');
const { loadSeed } = require('../seed/loadSeed');
const { build, phasesUpTo } = require('../factories');
const { accessTokenFor } = require('../fixtures/token.fixture');
const { blocked } = require('../utils/blockNetwork');

setupTestDB();

/**
 * The Stats tab's panels that dashboardBreakdowns.test.js leaves out: how
 * students are funded, the cities they want to study in, the courses applied
 * for and enrolled on, the rows behind "Top statistics", how fast applications
 * move, and what each student's row on the Analysis card carries.
 *
 * Every test asks about June 2024. The seed has nothing that old, so the
 * answer holds only what the test put there, and each expectation is the whole
 * panel and not a row picked out of it.
 */

const DAY = 24 * 60 * 60 * 1000;
const at = (iso) => new Date(iso);
const insert = (Model, records) => Model.insertMany(records, { timestamps: false });
const idOf = (record) => String(record._id || record.id || record);
const between = (from, to) => `startDate=${encodeURIComponent(from)}&endDate=${encodeURIComponent(to)}`;
const JUNE = between('2024-06-01T00:00:00.000Z', '2024-06-30T23:59:59.999Z');

describe('the Stats tab: funding, cities, courses, top statistics, speed and the analysis rows', () => {
  let u;
  const as = (user) => ({
    get: (path) =>
      request(app)
        .get(path)
        .set('Authorization', `Bearer ${accessTokenFor(user)}`),
  });
  const breakdowns = async (query = JUNE) => {
    const res = await as(u.staff).get(`/v1/students/dashboard-breakdowns?${query}`).expect(httpStatus.OK);
    return res.body;
  };
  // A student added on a day in June 2024.
  const student = (day, overrides = {}) => {
    const createdAt = at(`2024-06-${String(day).padStart(2, '0')}T09:00:00.000Z`);
    return build.student({ createdAt, updatedAt: createdAt, ...overrides });
  };
  // An application of theirs, made on the day the student was added unless told otherwise.
  const applicationOf = (aStudent, overrides = {}) =>
    build.application({
      studentId: aStudent._id,
      createdAt: aStudent.createdAt,
      updatedAt: aStudent.createdAt,
      ...overrides,
    });

  beforeEach(async () => {
    responseCache.clear();
    u = (await loadSeed()).users;
  });

  test('the seed has nothing in June 2024, so each panel starts empty', async () => {
    const answer = await breakdowns();

    expect(answer.funding).toEqual([]);
    expect(answer.sponsored).toBe(0);
    expect(answer.cities).toEqual([]);
    expect(answer.courses).toEqual({ applied: [], enrolled: [] });
    expect(answer.top).toEqual({ applications: [], enrolled: [] });
    expect(answer.analysis).toEqual([]);
    expect(answer.speed.leadToApplied).toEqual({ now: null, last: null, n: 0 });
    expect(answer.speed.appliedToOffer).toEqual({ now: null, last: null, n: 0 });
  });

  describe('how students are funded', () => {
    test('a government sponsor is "Sponsored", any other source is "Self-funded", and no source is not counted', async () => {
      await insert(Students, [
        student(3, { sourceOfFund: 'Govt Sponsor' }),
        student(4, { sourceOfFund: 'Govt Sponsor' }),
        student(5, { sourceOfFund: 'Govt Sponsor' }),
        student(6, { sourceOfFund: 'Personal Savings' }),
        student(7, { sourceOfFund: 'Help From Family' }),
        student(8),
      ]);

      const answer = await breakdowns();

      expect(answer.funding).toEqual([
        { label: 'Sponsored', n: 3 },
        { label: 'Self-funded', n: 2 },
      ]);
      expect(answer.sponsored).toBe(3);
    });

    test('a referral that was turned down is left out, and so is a student added outside the dates', async () => {
      const july = at('2024-07-02T09:00:00.000Z');
      await insert(Students, [
        student(3, { sourceOfFund: 'Govt Sponsor' }),
        student(4, { sourceOfFund: 'Govt Sponsor', stage: 'Denied' }),
        build.student({ sourceOfFund: 'Govt Sponsor', createdAt: july, updatedAt: july }),
      ]);

      const answer = await breakdowns();

      expect(answer.funding).toEqual([{ label: 'Sponsored', n: 1 }]);
      expect(answer.sponsored).toBe(1);
    });
  });

  describe('the cities students want to study in', () => {
    const inTheUK = (city) => ({ key: 'United Kingdom', value: city });

    test('are where the courses they applied for are taught, in the United Kingdom', async () => {
      const taughtInLeeds = build.course({ locations: [inTheUK('Leeds'), { key: 'Malaysia', value: 'Kuala Lumpur' }] });
      const taughtInTwo = build.course({ locations: [inTheUK('Leeds'), inTheUK('York')] });
      const first = student(3);
      const second = student(4);
      await insert(Courses, [taughtInLeeds, taughtInTwo]);
      await insert(Students, [first, second]);
      await insert(Application, [
        applicationOf(first, { course: taughtInLeeds._id }),
        applicationOf(second, { course: taughtInTwo._id }),
      ]);

      expect((await breakdowns()).cities).toEqual([
        { label: 'Leeds', n: 2 },
        { label: 'York', n: 1 },
      ]);
    });

    test('with no course linked, the campus named on the application is used', async () => {
      const aStudent = student(3);
      await insert(Students, [aStudent]);
      await insert(Application, [applicationOf(aStudent, { campus: { name: 'Glasgow' } })]);

      expect((await breakdowns()).cities).toEqual([{ label: 'Glasgow', n: 1 }]);
    });

    test("with neither, the city is the one most of that university's courses are taught in", async () => {
      const aStudent = student(3);
      await insert(Courses, [
        build.course({ institution: 'Flow University', locations: [inTheUK('Bath')] }),
        build.course({ institution: 'Flow University', locations: [inTheUK('Bath')] }),
        build.course({ institution: 'Flow University', locations: [inTheUK('Bristol')] }),
        build.course({ institution: 'Another University', locations: [inTheUK('Hull')] }),
      ]);
      await insert(Students, [aStudent]);
      // the name is matched whatever its capitals
      await insert(Application, [applicationOf(aStudent, { institute: { name: 'FLOW university' } })]);

      expect((await breakdowns()).cities).toEqual([{ label: 'Bath', n: 1 }]);
    });

    test('a student counts once for a city however many applications they have there, and not at all with none', async () => {
      const taughtInLeeds = build.course({ locations: [inTheUK('Leeds')] });
      const alsoInLeeds = build.course({ locations: [inTheUK('Leeds')] });
      const keen = student(3);
      const notApplied = student(4);
      const turnedDown = student(5, { stage: 'Denied' });
      await insert(Courses, [taughtInLeeds, alsoInLeeds]);
      await insert(Students, [keen, notApplied, turnedDown]);
      await insert(Application, [
        applicationOf(keen, { course: taughtInLeeds._id }),
        applicationOf(keen, { course: alsoInLeeds._id }),
        applicationOf(turnedDown, { course: taughtInLeeds._id }),
      ]);

      expect((await breakdowns()).cities).toEqual([{ label: 'Leeds', n: 1 }]);
    });
  });

  describe('courses, and the rows behind "Top statistics"', () => {
    test('applied for are the applications made in the dates that were sent, by course and by level', async () => {
      const first = student(3);
      const second = student(4);
      const named = build.course({ name: 'Named in the catalogue' });
      await insert(Courses, [named]);
      await insert(Students, [first, second]);
      await insert(Application, [
        applicationOf(first, { phase: 'Submitted', courseName: 'Computer Science', courseLevel: 'Undergraduate' }),
        applicationOf(second, { phase: 'Conditional offer', courseName: 'Computer Science', courseLevel: 'Postgraduate' }),
        applicationOf(second, { phase: 'Submitted', courseName: 'Law', courseLevel: 'Foundation' }),
        // still being prepared: not sent
        applicationOf(first, { phase: 'Initiated', courseName: 'Medicine' }),
        // sent in by a partner and not approved: not live
        applicationOf(first, { phase: 'Submitted', courseName: 'Dentistry', reviewStatus: 'SUBMITTED_BY_SUBAGENT' }),
        // made outside the dates
        applicationOf(first, { phase: 'Submitted', courseName: 'History', createdAt: at('2024-07-03T09:00:00.000Z') }),
        // no name of its own: named from the course it links to
        applicationOf(first, { phase: 'Submitted', courseName: undefined, course: named._id }),
      ]);

      expect((await breakdowns()).courses.applied).toEqual([
        { label: 'Computer Science', n: 2, levels: { "Bachelor's": 1, "Master's": 1 } },
        { label: 'Law', n: 1, levels: { Foundation: 1 } },
        { label: 'Named in the catalogue', n: 1, levels: { "Bachelor's": 1 } },
      ]);
    });

    test('enrolled on are the students enrolled in the dates, whenever they were added, by the application that got them there', async () => {
      const lastYear = at('2023-09-01T09:00:00.000Z');
      const enrolledInJune = build.student({
        stage: 'Enrolled',
        createdAt: lastYear,
        updatedAt: lastYear,
        enrolledAt: at('2024-06-15T09:00:00.000Z'),
      });
      const enrolledInMay = build.student({
        stage: 'Enrolled',
        createdAt: lastYear,
        updatedAt: lastYear,
        enrolledAt: at('2024-05-15T09:00:00.000Z'),
      });
      await insert(Students, [enrolledInJune, enrolledInMay]);
      await insert(Application, [
        applicationOf(enrolledInJune, { phase: 'Done', courseName: 'Engineering' }),
        applicationOf(enrolledInJune, { phase: 'Conditional offer', courseName: 'Not the one' }),
        applicationOf(enrolledInMay, { phase: 'Done', courseName: 'Enrolled too early' }),
      ]);

      const answer = await breakdowns();

      expect(answer.courses.enrolled).toEqual([{ label: 'Engineering', n: 1, levels: { "Bachelor's": 1 } }]);
      expect(answer.top.enrolled).toEqual([
        {
          studentId: idOf(enrolledInJune),
          studentName: `${enrolledInJune.firstName} ${enrolledInJune.lastName}`,
          uni: null,
          logoUrl: null,
          course: 'Engineering',
          level: "Bachelor's",
          intake: 'September 2026',
        },
      ]);
    });

    test('each application sent has a row saying whose it is, where, what for, and whether it reached an offer', async () => {
      const aStudent = student(3);
      await insert(Students, [aStudent]);
      await insert(Application, [
        applicationOf(aStudent, {
          phase: 'Submitted',
          courseName: 'Computer Science',
          institute: { name: 'Flow University', logoUrl: 'https://logos.invalid/flow.png' },
          intakeMonth: 'Jan',
          intakeYear: 2025,
        }),
        applicationOf(aStudent, { phase: 'Unconditional offer', courseName: 'Law', courseLevel: 'Masters' }),
        applicationOf(aStudent, { phase: 'Conditional offer', courseName: 'Refused', rejected: true }),
      ]);

      const rows = (await breakdowns()).top.applications;

      const byCourse = Object.fromEntries(rows.map((row) => [row.course, row]));
      expect(rows).toHaveLength(3);
      expect(byCourse['Computer Science']).toEqual({
        studentId: idOf(aStudent),
        studentName: `${aStudent.firstName} ${aStudent.lastName}`,
        offer: false,
        uni: 'Flow University',
        logoUrl: 'https://logos.invalid/flow.png',
        course: 'Computer Science',
        level: "Bachelor's",
        intake: 'January 2025',
      });
      expect(byCourse.Law).toMatchObject({ offer: true, level: "Master's", uni: null });
      // an offer that was refused is not an offer
      expect(byCourse.Refused).toMatchObject({ offer: false });
    });
  });

  describe('how fast applications move', () => {
    // A student added on `day`, whose application was submitted `lead` days
    // later and got its first offer `wait` days after that.
    const moved = (day, lead, wait, year = 2024) => {
      const createdAt = at(`${year}-06-${String(day).padStart(2, '0')}T09:00:00.000Z`);
      const aStudent = build.student({ createdAt, updatedAt: createdAt });
      const submitted = new Date(createdAt.getTime() + lead * DAY);
      const offered = new Date(submitted.getTime() + wait * DAY);
      const phases = phasesUpTo('Conditional offer', createdAt).map((phase) => {
        if (phase.status === 'Submitted') return { ...phase, createdDate: submitted, updatedDate: offered };
        if (phase.status === 'Conditional offer') return { ...phase, createdDate: offered, updatedDate: offered };
        return phase;
      });
      const application = build.application({
        studentId: aStudent._id,
        createdAt,
        updatedAt: offered,
        portalApplicationStatus: { applicationPhases: phases },
      });
      return { aStudent, application };
    };
    const insertAll = async (pairs) => {
      await insert(
        Students,
        pairs.map((pair) => pair.aStudent)
      );
      await insert(
        Application,
        pairs.map((pair) => pair.application)
      );
    };

    test('from being added to applying, and from applying to the first offer, the middle value in days', async () => {
      await insertAll([moved(1, 2, 3), moved(2, 4, 10), moved(3, 9, 20)]);

      const { speed } = await breakdowns();

      expect(speed.leadToApplied).toEqual({ now: 4, last: null, n: 3 });
      expect(speed.appliedToOffer).toEqual({ now: 10, last: null, n: 3 });
    });

    test('an application that is not past its first phase has not been applied, and one with no offer has no wait', async () => {
      const preparing = student(4);
      const waiting = student(5);
      await insertAll([moved(1, 2, 3)]);
      await insert(Students, [preparing, waiting]);
      await insert(Application, [
        applicationOf(preparing, { phase: 'Initiated' }),
        // submitted a week after it was made, as the factory dates phases; no offer yet
        applicationOf(waiting, { phase: 'Submitted' }),
      ]);

      const { speed } = await breakdowns();

      expect(speed.leadToApplied).toEqual({ now: 5, last: null, n: 2 });
      expect(speed.appliedToOffer).toEqual({ now: 3, last: null, n: 1 });
    });

    test('the waits for an offer are sorted into five lengths, each with its share', async () => {
      await insertAll([moved(1, 1, 3), moved(2, 1, 7), moved(3, 1, 13), moved(4, 1, 27), moved(5, 1, 28), moved(6, 1, 61)]);

      const { speed } = await breakdowns();

      expect(speed.buckets).toEqual([
        { label: '< 1 week', n: 1, pct: 17 },
        { label: '1–2 weeks', n: 2, pct: 33 },
        { label: '2–4 weeks', n: 1, pct: 17 },
        { label: '1–2 months', n: 1, pct: 17 },
        { label: '2+ months', n: 1, pct: 17 },
      ]);
    });

    test('beside each is the same for the same dates a year before', async () => {
      await insertAll([moved(1, 2, 3), moved(2, 6, 9, 2023), moved(3, 8, 15, 2023)]);

      const { speed } = await breakdowns();

      expect(speed.leadToApplied).toEqual({ now: 2, last: 7, n: 1 });
      expect(speed.appliedToOffer).toEqual({ now: 3, last: 12, n: 1 });
    });
  });

  describe("each student's row on the Analysis card", () => {
    const rowOf = (answer, aStudent) => answer.analysis.find((row) => row.id === idOf(aStudent));

    test('says how they are funded, the school they came from, their level, intake and provider', async () => {
      const aStudent = student(3, {
        sourceOfFund: 'Govt Sponsor',
        previousSchool: '  Seed High School ',
        preference: { courseLevel: 'Foundation', intakeMonth: 'Sep', intakeYear: '2025', provider: 'Seed Pathways' },
      });
      await insert(Students, [aStudent]);

      expect(rowOf(await breakdowns(), aStudent)).toEqual({
        id: idOf(aStudent),
        name: `${aStudent.firstName} ${aStudent.lastName}`,
        intake: 'September 2025',
        level: 'Foundation',
        school: 'Seed High School',
        funding: 'Sponsored',
        cities: [],
        unis: [],
        provider: 'Seed Pathways',
        channel: 'Walk-in',
        partner: 'Walk-in',
        applied: false,
        offer: false,
        enrolled: false,
      });
    });

    test('takes the level, intake and provider from their application when the student has none of their own', async () => {
      const aStudent = student(3);
      await insert(Students, [aStudent]);
      await insert(Application, [
        applicationOf(aStudent, {
          phase: 'Submitted',
          courseLevel: 'Foundation',
          provider: 'Seed Pathways',
          intakeMonth: 'January',
          intakeYear: 2025,
          institute: { name: 'Flow University' },
        }),
      ]);

      expect(rowOf(await breakdowns(), aStudent)).toMatchObject({
        level: 'Foundation',
        intake: 'January 2025',
        provider: 'Seed Pathways',
        unis: ['Flow University'],
        applied: true,
        offer: false,
        funding: null,
        school: null,
      });
    });

    test("names the partner who sent a referral in, and the channel for everybody else's", async () => {
      const fromSubAgent = student(3, { channel: 'subagent', createdBy: u.subAgentA._id });
      const fromSchool = student(4, { channel: 'counselor', createdBy: u.schoolA._id });
      const fromExhibition = student(5, { channel: 'exhibition', createdBy: u.counsellorA._id });
      const noChannel = student(6, { channel: undefined });
      await insert(Students, [fromSubAgent, fromSchool, fromExhibition, noChannel]);

      const answer = await breakdowns();

      expect(rowOf(answer, fromSubAgent)).toMatchObject({ channel: 'Sub-agent', partner: u.subAgentA.name });
      expect(rowOf(answer, fromSchool)).toMatchObject({ channel: 'School counselor', partner: u.schoolA.name });
      expect(rowOf(answer, fromExhibition)).toMatchObject({ channel: 'Exhibition', partner: 'Exhibition' });
      // a student with no channel recorded is taken to have walked in
      expect(rowOf(answer, noChannel)).toMatchObject({ channel: 'Walk-in', partner: 'Walk-in' });
    });
  });

  test('none of this tried to reach anything outside the machine', () => {
    expect(blocked).toEqual([]);
  });
});
