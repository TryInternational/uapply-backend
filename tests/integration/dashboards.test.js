const request = require('supertest');
const httpStatus = require('http-status');
const app = require('../../src/app');
const responseCache = require('../../src/middlewares/responseCache');
const setupTestDB = require('../utils/setupTestDB');
const { Application, Students, Leads, Fees } = require('../../src/models');
const { loadSeed } = require('../seed/loadSeed');
const { build, PHASES } = require('../factories');
const { accessTokenFor } = require('../fixtures/token.fixture');
const { blocked } = require('../utils/blockNetwork');

setupTestDB();

/**
 * The figures on the dashboards: applications, students, leads and fees.
 *
 * Each figure is checked against the same thing counted here in plain
 * JavaScript, from the seed or from a few records a test adds for the purpose.
 * Two ways of counting that agree are not proof the definition is the right
 * one, which is the owner's to say, but a change to either shows up.
 *
 * The answers of these routes are kept in memory for a minute, so that memory
 * is emptied before every test.
 */

const NOT_LIVE = ['DRAFT', 'SUBMITTED_BY_SUBAGENT', 'SUBMITTED_BY_COUNSELOR', 'REJECTED', 'RETURNED_FOR_EDIT'];
const OFFERS = ['Conditional offer', 'Unconditional offer'];

const idsOf = (list) => list.map((record) => String(record.id || record._id));
const at = (iso) => new Date(iso);
const insert = (Model, records) => Model.insertMany(records, { timestamps: false });

describe('the dashboards', () => {
  let seed;
  let u;
  const as = (user) => ({
    get: (path) =>
      request(app)
        .get(path)
        .set('Authorization', `Bearer ${accessTokenFor(user)}`),
  });

  beforeEach(async () => {
    responseCache.clear();
    seed = await loadSeed();
    u = seed.users;
  });

  describe('applications', () => {
    const isLive = (application) => !NOT_LIVE.includes(application.reviewStatus);
    const phaseOf = (application) => {
      const phases = application.portalApplicationStatus.applicationPhases;
      return (phases.find((p) => p.phaseState === 'AwaitingResponseStudent') || phases.find((p) => p.isCurrent)).status;
    };
    const counted = (applications) => ({
      byStage: PHASES.map((status) => ({ status, count: applications.filter((a) => phaseOf(a) === status).length })),
      submitted: applications.filter((a) => phaseOf(a) !== 'Initiated').length,
      openOffers: applications.filter((a) => OFFERS.includes(phaseOf(a))).length,
      total: applications.length,
    });
    const dashboard = async (query = '') => {
      const res = await as(u.staff).get(`/v1/application/application-dashboard-data${query}`).expect(httpStatus.OK);
      return res.body.applicationsData;
    };
    const drilldown = async (metric, query = '') => {
      const res = await as(u.staff)
        .get(`/v1/application/dashboard-drilldown?metric=${metric}${query}`)
        .expect(httpStatus.OK);
      return res.body;
    };
    const between = (from, to) =>
      `startDate=${encodeURIComponent(from.toISOString())}&endDate=${encodeURIComponent(to.toISOString())}`;

    test('the pipeline counts each live application once, at the phase it is at now', async () => {
      const live = seed.applications.filter(isLive);

      const { pipelineTotals } = await dashboard();

      expect(pipelineTotals).toEqual(counted(live));
      expect(pipelineTotals.total).toBe(10);
      expect(pipelineTotals.byStage.reduce((sum, stage) => sum + stage.count, 0)).toBe(pipelineTotals.total);
    });

    test('what a partner has sent in and nobody has approved is not in it', async () => {
      const waiting = seed.applications.filter((a) => !isLive(a));

      const { pipelineTotals } = await dashboard();

      expect(waiting).toHaveLength(5);
      expect(pipelineTotals.total).toBe(seed.applications.length - waiting.length);
    });

    test('submitted means past the first phase, and an open offer means holding one of the two offers', async () => {
      const { pipelineTotals } = await dashboard();
      const stage = (status) => pipelineTotals.byStage.find((s) => s.status === status).count;

      expect(pipelineTotals.submitted).toBe(pipelineTotals.total - stage('Initiated'));
      expect(pipelineTotals.openOffers).toBe(stage('Conditional offer') + stage('Unconditional offer'));
    });

    test('the chart by phase is the same count as the cards', async () => {
      const data = await dashboard();

      expect(data.applicationsCountByPhase).toEqual(data.pipelineTotals.byStage);
    });

    test('a range of dates keeps the applications made within it', async () => {
      const live = seed.applications.filter(isLive).sort((a, b) => a.createdAt - b.createdAt);
      const from = live[2].createdAt;
      const to = live[6].createdAt;
      const within = live.filter((a) => a.createdAt >= from && a.createdAt <= to);

      const { pipelineTotals } = await dashboard(`?${between(from, to)}`);

      expect(within.length).toBeGreaterThan(0);
      expect(within.length).toBeLessThan(live.length);
      expect(pipelineTotals).toEqual(counted(within));
    });

    test('the universities applied to most are counted over the same applications', async () => {
      const live = seed.applications.filter(isLive);
      const byName = {};
      live.forEach((a) => {
        byName[a.institute.name] = (byName[a.institute.name] || 0) + 1;
      });

      const { topUniversitiesByApplications } = await dashboard();

      const answered = {};
      topUniversitiesByApplications.forEach((row) => {
        answered[row._id.name] = row.count;
      });
      expect(answered).toEqual(byName);
      const countsInOrder = topUniversitiesByApplications.map((row) => row.count);
      expect(countsInOrder).toEqual([...countsInOrder].sort((a, b) => b - a));
    });

    describe('the list behind a card', () => {
      test('for submitted, is the applications the card counted, newest first', async () => {
        const expected = seed.applications
          .filter((a) => isLive(a) && phaseOf(a) !== 'Initiated')
          .sort((a, b) => b.createdAt - a.createdAt);

        const rows = await drilldown('submitted');

        expect(rows).toHaveLength((await dashboard()).pipelineTotals.submitted);
        expect(idsOf(rows)).toEqual(idsOf(expected));
      });

      test('for offers, is the applications holding an offer', async () => {
        const expected = seed.applications.filter((a) => isLive(a) && OFFERS.includes(phaseOf(a)));

        const rows = await drilldown('offers');

        expect(rows).toHaveLength((await dashboard()).pipelineTotals.openOffers);
        expect(idsOf(rows).sort()).toEqual(idsOf(expected).sort());
        expect(rows.every((row) => OFFERS.includes(row.stage))).toBe(true);
      });

      test('each row says whose application it is and who looks after them', async () => {
        const [row] = await drilldown('submitted');
        const application = seed.applications.find((a) => String(a._id) === row._id);
        const student = seed.students.find((s) => String(s._id) === String(application.studentId));
        const team = student.assignedTo.map(
          (a) => Object.values(seed.users).find((user) => String(user._id) === String(a.user)).name
        );

        expect(row).toMatchObject({
          applicationId: application.applicationId,
          stage: phaseOf(application),
          studentId: String(student._id),
          studentName: `${student.firstName} ${student.lastName}`,
          studentStage: student.stage,
          institute: { name: application.institute.name },
        });
        expect(row.counselors.sort()).toEqual(team.sort());
      });

      test('keeps to the same range of dates as the card', async () => {
        const live = seed.applications.filter(isLive).sort((a, b) => a.createdAt - b.createdAt);
        const range = between(live[2].createdAt, live[6].createdAt);

        const rows = await drilldown('submitted', `&${range}`);

        expect(rows).toHaveLength((await dashboard(`?${range}`)).pipelineTotals.submitted);
      });

      test('for a card that does not exist, is empty', async () => {
        expect(await drilldown('everything')).toEqual([]);
      });
    });
  });

  describe('students', () => {
    const KUWAIT = { english_name: 'Kuwait', alpha2_code: 'KW' };
    const OMAN = { english_name: 'Oman', alpha2_code: 'OM' };
    const april = 'startDate=2025-04-01&endDate=2025-04-30';
    const dashboard = async (query) => {
      const res = await as(u.staff).get(`/v1/students/student-dashboard-data?${query}`).expect(httpStatus.OK);
      return res.body;
    };

    // Four students made in April 2025 as the day is in Kuwait, and one made
    // half an hour into May there. Nothing in the seed is that old.
    beforeEach(async () => {
      await insert(Students, [
        build.student({
          createdAt: at('2025-03-31T21:30:00.000Z'),
          stage: 'Applied',
          nationality: KUWAIT,
          channel: 'exhibition',
        }),
        build.student({
          createdAt: at('2025-04-10T09:00:00.000Z'),
          stage: 'Enrolled',
          nationality: KUWAIT,
          channel: 'referral',
        }),
        build.student({
          createdAt: at('2025-04-12T09:00:00.000Z'),
          stage: 'NotApplied',
          nationality: OMAN,
          channel: 'direct',
        }),
        build.student({
          createdAt: at('2025-04-13T09:00:00.000Z'),
          stage: 'Denied',
          nationality: OMAN,
          channel: 'subagent',
        }),
        build.student({
          createdAt: at('2025-04-30T21:30:00.000Z'),
          stage: 'Applied',
          nationality: OMAN,
          channel: 'campaign',
        }),
      ]);
    });

    test('new students are the ones made on the days asked for, as the days are in Kuwait', async () => {
      expect((await dashboard(april)).newStudentsCount).toBe(4);
      expect((await dashboard('startDate=2025-05-01&endDate=2025-05-01')).newStudentsCount).toBe(1);
      expect((await dashboard('startDate=2025-03-31&endDate=2025-03-31')).newStudentsCount).toBe(0);
    });

    test('over a range that holds everything, new students are all of them', async () => {
      const everything = await dashboard('startDate=2025-01-01&endDate=2026-12-31');

      expect(everything.newStudentsCount).toBe(seed.students.length + 5);
    });

    test('by channel, every channel is listed, and a referral that was turned down is not counted', async () => {
      const { studentsByChannel } = await dashboard(april);

      expect(studentsByChannel).toEqual([
        { label: 'Sub-agent', count: 0 },
        { label: 'School counselor', count: 0 },
        { label: 'Online lead', count: 0 },
        { label: 'Walk-in', count: 1 },
        { label: 'Exhibition', count: 1 },
        { label: 'Referral', count: 1 },
        { label: 'Campaign', count: 0 },
        { label: 'Other', count: 0 },
      ]);
    });

    test('by channel over everything agrees with the seed counted by hand', async () => {
      const { studentsByChannel } = await dashboard('startDate=2025-06-01&endDate=2026-12-31');
      const label = { subagent: 'Sub-agent', counselor: 'School counselor', lead: 'Online lead', direct: 'Walk-in' };
      const byLabel = {};
      seed.students
        .filter((s) => s.stage !== 'Denied')
        .forEach((s) => {
          byLabel[label[s.channel]] = (byLabel[label[s.channel]] || 0) + 1;
        });

      studentsByChannel.forEach((row) => expect(row.count).toBe(byLabel[row.label] || 0));
    });

    test('by nationality counts the students who applied, enrolled ones included', async () => {
      const { topNationalities } = await dashboard(april);

      expect(topNationalities).toEqual([{ _id: 'Kuwait', countryCode: 'KW', count: 2 }]);
    });
  });

  describe('leads', () => {
    const lead = (day, extra = {}) =>
      build.lead({
        createdAt: at(`2025-03-${day}T12:00:00.000Z`),
        qualified: true,
        nationality: { english_name: 'Kuwait', alpha2_code: 'KW' },
        destination: { en_name: 'UK' },
        degree: { en_name: 'Bachelor' },
        ...extra,
      });
    const march = 'startDate=2025-03-01&endDate=2025-03-31';
    const dashboard = async (query = march) => {
      const res = await as(u.staff).get(`/v1/leads/leads-dashboard-data?${query}`).expect(httpStatus.OK);
      return res.body;
    };

    // Four qualified leads and one that is not, in March 2025, and a qualified
    // one in February. The seed's own leads are all from the winter after.
    beforeEach(async () => {
      await insert(Leads, [
        lead(10, { source: 'ulearn', status: 'New' }),
        lead(11, { source: 'uapply', status: 'Sent Whatsapp' }),
        lead(12, {
          source: 'uapply',
          status: 'Applied',
          destination: { en_name: 'Others' },
          nationality: { english_name: 'Oman', alpha2_code: 'OM' },
          degree: { en_name: 'Master' },
        }),
        lead(13, { source: 'uapply', status: 'Converted' }),
        lead(14, { source: 'uapply', status: 'New', qualified: false }),
        build.lead({
          createdAt: at('2025-02-20T12:00:00.000Z'),
          qualified: true,
          source: 'ulearn',
          destination: { en_name: 'UK' },
        }),
      ]);
    });

    test('qualified leads are counted by where they came from, where they are going and how far they have got', async () => {
      expect(await dashboard()).toMatchObject({
        qualifiedLeads: 4,
        unqualifiedLeads: 1,
        studentsUlearnCount: 1,
        studentsUapplyCount: 3,
        studentsUkCount: 3,
        studentsOthersCount: 1,
        studentsNewCount: 1,
        studentsWaCount: 1,
        studentsAppliedCount: 1,
      });
    });

    test('a lead made outside the dates asked for is not counted', async () => {
      expect(await dashboard('startDate=2025-02-01&endDate=2025-02-28')).toMatchObject({
        qualifiedLeads: 1,
        unqualifiedLeads: 0,
        studentsUlearnCount: 1,
      });
      expect((await dashboard('startDate=2025-01-01&endDate=2025-01-31')).qualifiedLeads).toBe(0);
    });

    test('the seed, which has no qualified lead, counts as eight that are not', async () => {
      expect(await dashboard('startDate=2025-06-01&endDate=2026-12-31')).toMatchObject({
        qualifiedLeads: 0,
        unqualifiedLeads: seed.leads.length,
      });
    });

    test('the countries and degrees the qualified leads come from most are listed, biggest first', async () => {
      const { top5ByCountry, top5ByDegree } = await dashboard();

      expect(top5ByCountry).toEqual([
        { _id: 'Kuwait', countryCode: 'KW', count: 3 },
        { _id: 'Oman', countryCode: 'OM', count: 1 },
      ]);
      expect(top5ByDegree).toEqual([
        { _id: 'Bachelor', count: 3 },
        { _id: 'Master', count: 1 },
      ]);
    });

    test('those lists stop at five, and keep to the dates asked for', async () => {
      const countries = ['Bahrain', 'Qatar', 'Egypt', 'Jordan', 'Lebanon'];
      await insert(
        Leads,
        countries.map((name, index) =>
          lead(20 + index, { nationality: { english_name: name }, degree: { en_name: `Degree ${index}` } })
        )
      );

      const inMarch = await dashboard();
      const february = await dashboard('startDate=2025-02-01&endDate=2025-02-28');

      expect(inMarch.top5ByCountry).toHaveLength(5);
      expect(inMarch.top5ByCountry[0]).toMatchObject({ _id: 'Kuwait', count: 3 });
      expect(inMarch.top5ByDegree).toHaveLength(5);
      expect(february.top5ByCountry).toEqual([{ _id: null, countryCode: null, count: 1 }]);
    });

    describe('the days asked for are days in Kuwait', () => {
      const early = (createdAt) =>
        build.lead({ createdAt: at(createdAt), qualified: true, source: 'uapply', destination: { en_name: 'UK' } });

      beforeEach(async () => {
        await insert(Leads, [
          early('2025-02-28T22:00:00.000Z'), // 01:00 on 1 March in Kuwait
          early('2025-03-31T22:00:00.000Z'), // 01:00 on 1 April in Kuwait
        ]);
      });

      test('a lead from the small hours of the first is counted, and one from the small hours after the last is not', async () => {
        expect((await dashboard()).qualifiedLeads).toBe(5);
        expect((await dashboard('startDate=2025-02-01&endDate=2025-02-28')).qualifiedLeads).toBe(1);
        expect((await dashboard('startDate=2025-04-01&endDate=2025-04-30')).qualifiedLeads).toBe(1);
      });

      test('the same is so when the range is sent as the moments the days begin and end, as the dashboard sends it', async () => {
        const from = encodeURIComponent('2025-02-28T21:00:00.000Z');
        const to = encodeURIComponent('2025-03-31T20:59:59.999Z');

        const sent = await dashboard(`startDate=${from}&endDate=${to}`);

        expect(sent.qualifiedLeads).toBe(5);
        expect(sent.top5ByCountry[0].count).toBe(3);
      });
    });

    test('the two lists can also be asked for on their own, with dates or for all time', async () => {
      const inMarch = await as(u.staff).get(`/v1/leads/country?${march}`).expect(httpStatus.OK);
      const always = await as(u.staff).get('/v1/leads/country').expect(httpStatus.OK);
      const degrees = await as(u.staff).get('/v1/leads/degree').expect(httpStatus.OK);

      expect(inMarch.body.map((row) => [row._id, row.count])).toEqual([
        ['Kuwait', 3],
        ['Oman', 1],
      ]);
      expect(always.body.reduce((sum, row) => sum + row.count, 0)).toBe(5);
      expect(degrees.body.reduce((sum, row) => sum + row.count, 0)).toBe(5);
    });
  });

  describe('fees', () => {
    const june = 'startDate=2025-06-01&endDate=2025-06-30';
    const dashboard = async (query = june) => {
      const res = await as(u.staff).get(`/v1/fees/fees-dashboard-data?${query}`).expect(httpStatus.OK);
      return res.body;
    };
    const taken = (amounts) =>
      amounts
        .filter((row) => row.bookingCount > 0)
        .map(({ feeType, year, month, totalAmount, bookingCount }) => ({ feeType, year, month, totalAmount, bookingCount }));
    const byMonth = (a, b) =>
      `${a.feeType}${a.year}${String(a.month).padStart(2, '0')}`.localeCompare(
        `${b.feeType}${b.year}${String(b.month).padStart(2, '0')}`
      );

    beforeEach(async () => {
      await insert(Fees, [
        // half past midnight on the first of June in Kuwait
        build.fee({ feeType: 'office-fees', createdDate: at('2025-05-31T21:30:00.000Z'), tag: { amount: 50 } }),
        // an amount kept as text, as older records have it
        build.fee({ feeType: 'office-fees', createdDate: at('2025-06-15T12:00:00.000Z'), tag: { amount: '37.5' } }),
        // these three kinds are dated by the day written on them, not the day they were entered
        build.fee({
          feeType: 'ielts-booking',
          createdDate: at('2025-01-05T12:00:00.000Z'),
          tag: { amount: 60, dateSubmitted: '2025-06-20' },
        }),
        build.fee({
          feeType: 'english-self-funded',
          createdDate: at('2025-01-05T12:00:00.000Z'),
          tag: { amount: 200, noOfWeeks: '4', dateSubmitted: '2025-06-10' },
        }),
        build.fee({
          feeType: 'english-self-funded',
          createdDate: at('2025-01-05T12:00:00.000Z'),
          tag: { amount: 100, noOfWeeks: '2', dateSubmitted: '2025-07-10' },
        }),
      ]);
    });

    test('money taken is totalled by kind of fee and by month, as the month is in Kuwait', async () => {
      const { amounts } = await dashboard();

      expect(taken(amounts).sort(byMonth)).toEqual(
        [
          { feeType: 'office-fees', year: 2025, month: 6, totalAmount: 87.5, bookingCount: 2 },
          { feeType: 'office-fees', year: 2025, month: 12, totalAmount: 103, bookingCount: 1 },
          { feeType: 'office-fees', year: 2026, month: 1, totalAmount: 104, bookingCount: 1 },
          { feeType: 'ielts-booking', year: 2025, month: 6, totalAmount: 60, bookingCount: 1 },
          { feeType: 'english-self-funded', year: 2025, month: 6, totalAmount: 200, bookingCount: 1 },
          { feeType: 'english-self-funded', year: 2025, month: 7, totalAmount: 100, bookingCount: 1 },
        ].sort(byMonth)
      );
    });

    test('every kind of fee has a row for every month of every year there is, empty or not', async () => {
      const { amounts } = await dashboard();
      const kinds = [...new Set(amounts.map((row) => row.feeType))];

      expect(kinds.sort()).toEqual(['english-self-funded', 'ielts-booking', 'office-fees']);
      expect(amounts).toHaveLength(kinds.length * 2 * 12);
    });

    test('the totals by month do not depend on the dates asked for', async () => {
      const inJune = await dashboard(june);
      const inJanuary = await dashboard('startDate=2026-01-01&endDate=2026-01-31');

      expect(taken(inJanuary.amounts).sort(byMonth)).toEqual(taken(inJune.amounts).sort(byMonth));
    });

    test('self-funded English courses are totalled for the dates asked for', async () => {
      expect((await dashboard(june)).selfFunded).toEqual({ totalBookings: 1, totalWeeks: 4, totalAmount: 200 });
      expect((await dashboard('startDate=2025-06-01&endDate=2025-07-31')).selfFunded).toEqual({
        totalBookings: 2,
        totalWeeks: 6,
        totalAmount: 300,
      });
      expect((await dashboard('startDate=2025-08-01&endDate=2025-08-31')).selfFunded).toEqual({
        totalBookings: 0,
        totalWeeks: 0,
        totalAmount: 0,
      });
    });
  });

  describe('an answer is kept for a minute', () => {
    const path = '/v1/application/application-dashboard-data';
    const ask = (query = '') => as(u.staff).get(`${path}${query}`).expect(httpStatus.OK);

    test('the same question asked again is answered from memory', async () => {
      const first = await ask();
      const second = await ask();

      expect(first.headers['x-cache']).toBe('MISS');
      expect(second.headers['x-cache']).toBe('HIT');
      expect(second.body).toEqual(first.body);
    });

    test('so a change made in between does not show until the minute is up', async () => {
      const before = await ask();
      await Application.deleteOne({ _id: seed.applications.find((a) => !NOT_LIVE.includes(a.reviewStatus))._id });

      const stillOld = await ask();
      responseCache.clear();
      const fresh = await ask();

      expect(stillOld.body.applicationsData.pipelineTotals.total).toBe(before.body.applicationsData.pipelineTotals.total);
      expect(fresh.body.applicationsData.pipelineTotals.total).toBe(before.body.applicationsData.pipelineTotals.total - 1);
    });

    test('a different question is worked out afresh, whoever asks', async () => {
      await ask();

      const other = await ask('?startDate=2025-01-01T00:00:00.000Z&endDate=2026-12-31T00:00:00.000Z');
      const same = await as(u.admin).get(path).expect(httpStatus.OK);

      expect(other.headers['x-cache']).toBe('MISS');
      expect(same.headers['x-cache']).toBe('HIT');
    });

    test('an answer that is a refusal is not kept', async () => {
      const first = await as(u.staff).get('/v1/fees/fees-dashboard-data');
      const second = await as(u.staff).get('/v1/fees/fees-dashboard-data');

      expect(first.status).toBe(httpStatus.BAD_REQUEST);
      expect(second.status).toBe(httpStatus.BAD_REQUEST);
      expect(second.headers['x-cache']).toBe('MISS');
    });
  });

  test('the student and application dashboards are for staff', async () => {
    const routes = [
      '/v1/students/student-dashboard-data?startDate=2025-01-01&endDate=2026-12-31',
      '/v1/students/dashboard-breakdowns',
      '/v1/application/application-dashboard-data',
      '/v1/application/dashboard-drilldown?metric=submitted',
    ];
    // eslint-disable-next-line no-restricted-syntax
    for (const route of routes) {
      // eslint-disable-next-line no-await-in-loop
      await as(u.subAgentA).get(route).expect(httpStatus.FORBIDDEN);
      // eslint-disable-next-line no-await-in-loop
      await as(u.schoolA).get(route).expect(httpStatus.FORBIDDEN);
      // eslint-disable-next-line no-await-in-loop
      await as(u.staff).get(route).expect(httpStatus.OK);
    }
  });

  describe('when the dates are missing or are not dates', () => {
    const NONSENSE = 'startDate=soon&endDate=later';

    test('the students dashboard with no dates answers for all time', async () => {
      const res = await as(u.staff).get('/v1/students/student-dashboard-data').expect(httpStatus.OK);

      expect(res.body.newStudentsCount).toBe(seed.students.length);
    });

    test('the students dashboard refuses half a range, and dates that are not dates', async () => {
      await as(u.staff).get('/v1/students/student-dashboard-data?startDate=2025-04-01').expect(httpStatus.BAD_REQUEST);
      await as(u.staff).get('/v1/students/student-dashboard-data?endDate=2025-04-30').expect(httpStatus.BAD_REQUEST);
      await as(u.staff).get(`/v1/students/student-dashboard-data?${NONSENSE}`).expect(httpStatus.BAD_REQUEST);
    });

    test('the fees and leads dashboards ask for them', async () => {
      const fees = await as(u.staff).get('/v1/fees/fees-dashboard-data').expect(httpStatus.BAD_REQUEST);
      const leads = await as(u.staff).get('/v1/leads/leads-dashboard-data').expect(httpStatus.BAD_REQUEST);

      expect(fees.body.message).toMatch(/startDate and endDate/);
      expect(leads.body.message).toMatch(/startDate and endDate/);
      await as(u.staff).get(`/v1/fees/fees-dashboard-data?${NONSENSE}`).expect(httpStatus.BAD_REQUEST);
      await as(u.staff).get(`/v1/leads/leads-dashboard-data?${NONSENSE}`).expect(httpStatus.BAD_REQUEST);
      await as(u.staff).get('/v1/leads/leads-dashboard-data?startDate=2025-03-01').expect(httpStatus.BAD_REQUEST);
    });
  });

  // How things are today, written down so a change shows up. It does not let
  // anybody see or change what they should not. When it is changed, the test
  // fails and is rewritten to say what is then true.
  describe('not as one would expect yet', () => {
    test('on the leads dashboard a converted lead is in the total and under none of the stages, and "closed" is always nought', async () => {
      const qualified = (createdAt, status) =>
        build.lead({ createdAt: at(createdAt), qualified: true, source: 'uapply', destination: { en_name: 'UK' }, status });
      await insert(Leads, [
        qualified('2025-03-10T12:00:00.000Z', 'Converted'),
        qualified('2025-03-11T12:00:00.000Z', 'New'),
      ]);

      const res = await as(u.staff)
        .get('/v1/leads/leads-dashboard-data?startDate=2025-03-01&endDate=2025-03-31')
        .expect(httpStatus.OK);
      const march = res.body;

      expect(march.qualifiedLeads).toBe(2);
      expect(march.studentsNewCount + march.studentsWaCount + march.studentsAppliedCount + march.studentsClosedCount).toBe(
        1
      );
      expect(march.studentsClosedCount).toBe(0);
    });
  });

  test('none of this tried to reach anything outside the machine', () => {
    expect(blocked).toEqual([]);
  });
});
