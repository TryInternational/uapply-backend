const request = require('supertest');
const httpStatus = require('http-status');
const app = require('../../src/app');
const setupTestDB = require('../utils/setupTestDB');
const { Courses } = require('../../src/models');
const { loadSeed } = require('../seed/loadSeed');
const { build } = require('../factories');

setupTestDB();

/**
 * The course catalogue, as the Courses pages ask for it.
 *
 * Staff and school counsellors pick a course from this list and apply from
 * it, so a course the list leaves out is one nobody can apply to on screen.
 * The pages always ask for one country, with every other filter named and
 * left empty until it is used; `asThePagesAsk` builds that same question.
 *
 * What a course's own page says (its intakes, campuses and university) is
 * kept apart and found by the course's reference; an application is made from
 * that record, so it is checked here too.
 */

const insert = (records) => Courses.insertMany(records, { timestamps: false });

const asThePagesAsk = (filters = {}) => {
  const named = {
    subjects: '',
    country: 'United Kingdom',
    attendanceTypes: '',
    courseLevel: '',
    institution: '',
    intakeMonths: '',
    courseDurationValues: '',
    placementAvailable: '',
    city: '',
    limit: 18,
    page: 1,
    ...filters,
  };
  const query = Object.entries(named)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
  return `/v1/courses/?${query}`;
};

describe('the course catalogue', () => {
  let seed;
  const list = async (filters) => (await request(app).get(asThePagesAsk(filters)).expect(httpStatus.OK)).body;
  const namesOf = (body) => body.results.map((course) => course.name).sort();

  beforeEach(async () => {
    seed = await loadSeed();
  });

  describe('the list', () => {
    test('holds every course in the country asked for', async () => {
      const body = await list();
      expect(body.totalResults).toBe(2);
      expect(namesOf(body)).toEqual(seed.courses.map((course) => course.name).sort());
    });

    test('gives each course what a card shows and what an application is made from', async () => {
      const body = await list();
      const [first] = seed.courses;
      const shown = body.results.find((course) => course.id === String(first._id));
      expect(shown).toMatchObject({
        id: String(first._id),
        courseRefId: first.courseRefId,
        name: first.name,
        courseLevel: 'Undergraduate',
        institution: seed.universities[0].name,
        institutionSlug: seed.universities[0].slug,
      });
    });

    test('leaves out a course in another country, and one with no place at all', async () => {
      await insert([
        build.course({ name: 'Elsewhere', locations: [{ key: 'Australia', value: 'Sydney' }] }),
        build.course({ name: 'Nowhere', locations: [] }),
      ]);
      const body = await list();
      expect(body.totalResults).toBe(2);
      expect(namesOf(body)).not.toContain('Elsewhere');
      expect(namesOf(body)).not.toContain('Nowhere');
      expect(namesOf(await list({ country: 'Australia' }))).toEqual(['Elsewhere']);
    });

    test('by level', async () => {
      const body = await list({ courseLevel: 'Postgraduate' });
      expect(namesOf(body)).toEqual([seed.courses[1].name]);
    });

    test('by university, one or several', async () => {
      const [first, second] = seed.universities;
      expect(namesOf(await list({ institution: first.slug }))).toEqual([seed.courses[0].name]);
      expect((await list({ institution: `${first.slug},${second.slug}` })).totalResults).toBe(2);
      expect((await list({ institution: 'no-such-university' })).totalResults).toBe(0);
    });

    test('by city, one or several', async () => {
      await insert([build.course({ name: 'In Leeds', locations: [{ key: 'United Kingdom', value: 'Leeds' }] })]);
      expect(namesOf(await list({ city: 'Leeds' }))).toEqual(['In Leeds']);
      expect((await list({ city: 'London' })).totalResults).toBe(2);
      expect((await list({ city: 'Leeds,London' })).totalResults).toBe(3);
    });

    test('a city is only matched in the country asked for', async () => {
      await insert([build.course({ name: 'London, Ontario', locations: [{ key: 'Canada', value: 'London' }] })]);
      expect(namesOf(await list({ city: 'London' }))).not.toContain('London, Ontario');
    });

    test('by the month it starts in', async () => {
      await insert([build.course({ name: 'Starts in May', intakeMonths: ['May'] })]);
      expect(namesOf(await list({ intakeMonths: 'May' }))).toEqual(['Starts in May']);
      expect((await list({ intakeMonths: 'May,September' })).totalResults).toBe(3);
    });

    test('by how it is attended', async () => {
      await insert([build.course({ name: 'Part time', attendanceTypes: ['PartTime'] })]);
      expect(namesOf(await list({ attendanceTypes: 'PartTime' }))).toEqual(['Part time']);
      expect((await list({ attendanceTypes: 'FullTime' })).totalResults).toBe(2);
    });

    test('by how long it lasts, one length or several', async () => {
      await insert([
        build.course({ name: 'One year', courseDurationValues: [360] }),
        build.course({ name: 'Two years', courseDurationValues: [720] }),
      ]);
      expect(namesOf(await list({ courseDurationValues: '360' }))).toEqual(['One year']);
      expect(namesOf(await list({ courseDurationValues: '360,720' }))).toEqual(['One year', 'Two years']);
    });

    test('by subject', async () => {
      await insert([build.course({ name: 'Law', subjects: ['law'] })]);
      expect(namesOf(await list({ subjects: 'law' }))).toEqual(['Law']);
      expect((await list({ subjects: 'law,medicine' })).totalResults).toBe(1);
    });

    test('by words typed: every word has to be in the name or the university', async () => {
      await insert([
        build.course({ name: 'Marine Biology', institution: 'Seed Coast University' }),
        build.course({ name: 'Marine Engineering', institution: 'Seed Hill University' }),
      ]);
      expect(namesOf(await list({ search: 'marine' }))).toEqual(['Marine Biology', 'Marine Engineering']);
      expect(namesOf(await list({ search: 'marine coast' }))).toEqual(['Marine Biology']);
      expect((await list({ search: 'marine nowhere' })).totalResults).toBe(0);
    });

    test('words typed are read as they are, not as a pattern', async () => {
      await insert([build.course({ name: 'C++ (Honours)' })]);
      expect(namesOf(await list({ search: 'c++ (honours)' }))).toEqual(['C++ (Honours)']);
      expect((await list({ search: '.*' })).totalResults).toBe(0);
    });

    test('by yearly fee: from the lower figure up to, but not including, the higher', async () => {
      await insert([
        build.course({ name: 'At 20000', approxAnnualFee: 20000 }),
        build.course({ name: 'At 25000', approxAnnualFee: 25000 }),
        build.course({ name: 'At 30000', approxAnnualFee: 30000 }),
      ]);
      expect(namesOf(await list({ feeMin: 20000, feeMax: 30000 }))).toEqual(['At 20000', 'At 25000']);
      expect(namesOf(await list({ feeMin: 30000 }))).toEqual(['At 30000']);
    });

    test('says how many universities the courses found are at, when asked', async () => {
      const [first] = seed.universities;
      await insert([build.course({ name: 'A second course', institution: first.name, institutionSlug: first.slug })]);
      const asked = await list({ withUniCount: 'true' });
      expect(asked.totalResults).toBe(3);
      expect(asked.universityCount).toBe(2);
      expect((await list()).universityCount).toBeUndefined();
    });

    test('comes a page at a time', async () => {
      const first = await list({ limit: 1, page: 1 });
      const second = await list({ limit: 1, page: 2 });
      expect(first.totalResults).toBe(2);
      expect(first.totalPages).toBe(2);
      expect(first.results).toHaveLength(1);
      expect(second.results).toHaveLength(1);
      expect(first.results[0].id).not.toBe(second.results[0].id);
    });
  });

  describe('one course', () => {
    test('is found by its id', async () => {
      const [first] = seed.courses;
      const res = await request(app).get(`/v1/courses/${first._id}`).expect(httpStatus.OK);
      expect(res.body).toMatchObject({ id: String(first._id), name: first.name });
    });

    test('an id that is no course is not found', async () => {
      await request(app).get(`/v1/courses/${build.course()._id}`).expect(httpStatus.NOT_FOUND);
    });
  });

  describe("what a course's own page says", () => {
    test('is found by the reference the course carries', async () => {
      const [first] = seed.courses;
      const res = await request(app).get(`/v1/courseDetails/${first.courseRefId}`).expect(httpStatus.OK);
      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({
        courseRefId: first.courseRefId,
        name: first.name,
        courseLevel: first.courseLevel,
        institution: { name: seed.universities[0].name, slug: seed.universities[0].slug },
        courseIntakes: [{ intakeMonth: 'September' }, { intakeMonth: 'January' }],
        campusList: [{ name: 'Seed Main Campus' }],
      });
    });

    test('every course in the seed has one', async () => {
      const found = await Promise.all(
        seed.courses.map((course) => request(app).get(`/v1/courseDetails/${course.courseRefId}`).expect(httpStatus.OK))
      );
      found.forEach((res) => expect(res.body).toHaveLength(1));
    });

    test('a reference no course carries gives an empty list, not an error', async () => {
      const res = await request(app).get('/v1/courseDetails/no-such-course').expect(httpStatus.OK);
      expect(res.body).toEqual([]);
    });
  });

  describe('the lists the filters are chosen from', () => {
    test('count the catalogue by university, level, city, intake and how it is attended', async () => {
      const res = await request(app).get('/v1/courses/facets').expect(httpStatus.OK);
      const [first, second] = seed.universities;
      expect(res.body.total).toBe(2);
      expect(res.body.universities).toEqual([
        { value: first.slug, label: first.name, count: 1 },
        { value: second.slug, label: second.name, count: 1 },
      ]);
      expect(res.body.levels).toEqual(
        expect.arrayContaining([
          { value: 'Undergraduate', count: 1 },
          { value: 'Postgraduate', count: 1 },
        ])
      );
      expect(res.body.cities).toEqual([{ value: 'London', count: 2 }]);
      expect(res.body.intakes).toEqual(
        expect.arrayContaining([
          { value: 'September', count: 2 },
          { value: 'January', count: 2 },
        ])
      );
      expect(res.body.modes).toEqual([{ value: 'FullTime', count: 2 }]);
    });
  });
});
