const request = require('supertest');
const httpStatus = require('http-status');
const app = require('../../src/app');
const setupTestDB = require('../utils/setupTestDB');
const { Fees, Leads, Students, Reminder, Goal } = require('../../src/models');
const { loadSeed } = require('../seed/loadSeed');
const { FEE_TYPES, LEAD_STATUSES } = require('../factories');
const { accessTokenFor } = require('../fixtures/token.fixture');
const { blocked } = require('../utils/blockNetwork');

setupTestDB();

/**
 * Fees, leads and the company goals, as staff use them.
 *
 * The seed's fees and leads are laid out so the answers are known: each type of
 * fee once on the last day of December 2025 and once on the first of January
 * 2026, and each lead status once unassigned and once assigned.
 */

const idsOf = (list) => list.map((record) => String(record.id || record._id)).sort();

describe('fees, leads and goals', () => {
  let seed;
  let u;
  let startedAt;
  const as = (user) => {
    const token = `Bearer ${accessTokenFor(user)}`;
    return {
      get: (path) => request(app).get(path).set('Authorization', token),
      post: (path, body = {}) => request(app).post(path).set('Authorization', token).send(body),
      patch: (path, body = {}) => request(app).patch(path).set('Authorization', token).send(body),
      put: (path, body = {}) => request(app).put(path).set('Authorization', token).send(body),
      delete: (path) => request(app).delete(path).set('Authorization', token),
    };
  };

  beforeEach(async () => {
    seed = await loadSeed();
    u = seed.users;
    startedAt = Date.now();
  });

  describe('fees', () => {
    const feeOf = (feeType) => seed.fees.find((f) => f.feeType === feeType);
    const stored = (aFee) => Fees.findById(aFee._id || aFee.id).lean();

    describe('the list', () => {
      test('holds every fee, a page at a time', async () => {
        const all = await as(u.staff).get('/v1/fees?limit=100').expect(httpStatus.OK);
        const page = await as(u.staff).get('/v1/fees?limit=3&page=3').expect(httpStatus.OK);

        expect(idsOf(all.body.results)).toEqual(idsOf(seed.fees));
        expect(page.body).toMatchObject({ page: 3, limit: 3, totalPages: 3, totalResults: 8 });
        expect(page.body.results).toHaveLength(2);
      });

      test.each(FEE_TYPES)('filters by type %s', async (feeType) => {
        const res = await as(u.staff).get(`/v1/fees?limit=100&feeType=${feeType}`).expect(httpStatus.OK);

        expect(idsOf(res.body.results)).toEqual(idsOf(seed.fees.filter((f) => f.feeType === feeType)));
        expect(res.body.results).toHaveLength(2);
      });

      test('filters to the fees of one student', async () => {
        const payer = seed.students.find((s) => String(s._id) === String(seed.fees[0].student));
        const other = seed.students.find((s) => String(s._id) !== String(payer._id));

        const theirs = await as(u.staff).get(`/v1/fees?limit=100&student=${payer._id}`).expect(httpStatus.OK);
        const nobodys = await as(u.staff).get(`/v1/fees?limit=100&student=${other._id}`).expect(httpStatus.OK);

        expect(theirs.body.results).toHaveLength(8);
        expect(nobodys.body.results).toEqual([]);
      });

      test('filters to fees that are linked to a student', async () => {
        await Fees.updateOne({ _id: seed.fees[0]._id }, { $unset: { student: 1 } });

        const res = await as(u.staff).get('/v1/fees?limit=100&linked=true').expect(httpStatus.OK);

        expect(res.body.results).toHaveLength(7);
      });
    });

    describe('adding one', () => {
      test('stores it, with the day it is dated kept as that day', async () => {
        const res = await as(u.staff)
          .post('/v1/fees', {
            feeType: 'office-fees',
            tag: { amount: 250, currency: 'KWD', fullName: 'Rana Testwell' },
            // Midnight in Kuwait is 21:00 the evening before in UTC.
            createdDate: '2026-01-09T21:00:00.000Z',
          })
          .expect(httpStatus.CREATED);

        const made = await stored(res.body);
        expect(made).toMatchObject({
          feeType: 'office-fees',
          tag: { amount: 250, currency: 'KWD', fullName: 'Rana Testwell' },
        });
        // Stored as noon UTC on the Kuwait day that was picked: 10 January.
        expect(made.createdDate.toISOString()).toBe('2026-01-10T12:00:00.000Z');
      });

      test('a type the model does not know is refused', async () => {
        await as(u.staff)
          .post('/v1/fees', { feeType: 'pocket-money', tag: { amount: 1 } })
          .expect(httpStatus.BAD_REQUEST);

        expect(await Fees.countDocuments()).toBe(8);
      });
    });

    describe('changing one', () => {
      test('the details sent replace the ones that were there', async () => {
        const fee = feeOf('office-fees');
        expect(fee.tag).toHaveProperty('note');

        await as(u.staff)
          .patch(`/v1/fees/${fee._id}`, { tag: { amount: 999, salesPerson: 'Seed Seller' } })
          .expect(httpStatus.OK);

        // Replaced whole, not merged: what was not sent again is gone.
        expect((await stored(fee)).tag).toEqual({ amount: 999, salesPerson: 'Seed Seller' });
      });

      test('a date on the same day leaves the stored moment as it was', async () => {
        const fee = feeOf('office-fees');

        await as(u.staff).patch(`/v1/fees/${fee._id}`, { createdDate: '2025-12-31T18:30:00.000Z' }).expect(httpStatus.OK);

        expect((await stored(fee)).createdDate.toISOString()).toBe(fee.createdDate.toISOString());
      });

      test('a date on another day moves the fee to that day', async () => {
        const fee = feeOf('office-fees');

        await as(u.staff).patch(`/v1/fees/${fee._id}`, { createdDate: '2026-02-03T05:00:00.000Z' }).expect(httpStatus.OK);

        expect((await stored(fee)).createdDate.toISOString()).toBe('2026-02-03T12:00:00.000Z');
      });

      test('one that does not exist is 404', async () => {
        await as(u.staff)
          .patch('/v1/fees/5eed00080000000000ffffff', { tag: { amount: 1 } })
          .expect(httpStatus.NOT_FOUND);
      });
    });

    test('deleting one removes it, and one that does not exist is 404', async () => {
      const fee = feeOf('student-visa');

      await as(u.staff).delete(`/v1/fees/${fee._id}`).expect(httpStatus.NO_CONTENT);
      await as(u.staff).delete(`/v1/fees/${fee._id}`).expect(httpStatus.NOT_FOUND);

      expect(await stored(fee)).toBeNull();
      expect(await Fees.countDocuments()).toBe(7);
    });

    describe('search', () => {
      beforeEach(async () => {
        await Fees.updateOne(
          { _id: feeOf('office-fees')._id },
          { $set: { 'tag.fullName': 'Rana Testwell', 'tag.phoneNo': '+96509900007' } }
        );
      });

      test('finds a fee of one type by the name or phone number on it', async () => {
        const byName = await as(u.staff).get('/v1/fees/search/testwell?feeType=office-fees').expect(httpStatus.OK);
        const byPhone = await as(u.staff)
          .get(`/v1/fees/search/${encodeURIComponent('+96509900007')}?feeType=office-fees`)
          .expect(httpStatus.OK);

        expect(idsOf(byName.body.results)).toEqual([String(feeOf('office-fees')._id)]);
        expect(idsOf(byPhone.body.results)).toEqual([String(feeOf('office-fees')._id)]);
      });

      test('does not find it under another type, and treats what is typed as plain text', async () => {
        const otherType = await as(u.staff).get('/v1/fees/search/testwell?feeType=student-visa').expect(httpStatus.OK);
        const pattern = await as(u.staff)
          .get(`/v1/fees/search/${encodeURIComponent('.*')}?feeType=office-fees`)
          .expect(httpStatus.OK);

        expect(otherType.body.results).toEqual([]);
        expect(pattern.body.results).toEqual([]);
      });
    });

    describe('sales figures', () => {
      test('need both dates and a type that exists', async () => {
        await as(u.staff).get('/v1/fees/sales?feeType=office-fees').expect(httpStatus.BAD_REQUEST);
        await as(u.staff)
          .get('/v1/fees/sales?feeType=pocket-money&startDate=2025-12-01&endDate=2026-01-31')
          .expect(httpStatus.BAD_REQUEST);
      });
    });
  });

  describe('leads', () => {
    const leadWith = (status, assigned) => seed.leads.find((l) => l.status === status && !!l.assignedTo === assigned);
    const stored = (aLead) => Leads.findById(aLead._id || aLead.id).lean();

    describe('the list', () => {
      test('holds every lead', async () => {
        const res = await as(u.staff).get('/v1/leads?limit=100').expect(httpStatus.OK);

        expect(idsOf(res.body.results)).toEqual(idsOf(seed.leads));
      });

      test.each(LEAD_STATUSES)('filters by status %s', async (status) => {
        const res = await as(u.staff)
          .get(`/v1/leads?limit=100&status=${encodeURIComponent(status)}`)
          .expect(httpStatus.OK);

        expect(idsOf(res.body.results)).toEqual(idsOf(seed.leads.filter((l) => l.status === status)));
        expect(res.body.results).toHaveLength(2);
      });

      test('counts by status in one request, with "all" for every lead', async () => {
        const res = await as(u.staff)
          .get(`/v1/leads?countsByStatus=${encodeURIComponent('all,New,Sent Whatsapp,Applied,Converted,Nowhere')}`)
          .expect(httpStatus.OK);

        expect(res.body).toEqual({ counts: { all: 8, New: 2, 'Sent Whatsapp': 2, Applied: 2, Converted: 2, Nowhere: 0 } });
      });
    });

    describe('a lead coming in', () => {
      const incoming = (extra = {}) => ({
        fullname: 'Rana Testwell',
        email: 'new.lead@example.com',
        phoneNo: '+96509900002',
        nationality: { english_name: 'Kuwait' },
        residence: { english_name: 'Kuwait' },
        destination: { en_name: 'UK' },
        degree: { en_name: 'Bachelor' },
        countriesTraveled: [],
        ...extra,
      });

      test('is stored as New, and needs no token', async () => {
        const res = await request(app).post('/v1/leads').send(incoming()).expect(httpStatus.CREATED);

        expect(await stored(res.body)).toMatchObject({
          fullname: 'Rana Testwell',
          status: 'New',
          email: 'new.lead@example.com',
        });
        expect(await Leads.countDocuments()).toBe(9);
      });

      test.each([
        ['a listed nationality bound for the UK', {}, true],
        ['a listed nationality bound elsewhere', { destination: { en_name: 'USA' } }, false],
        ['another nationality bound for the UK', { nationality: { english_name: 'Brazil' } }, false],
        [
          'another nationality bound for the UK whose family income qualifies',
          { nationality: { english_name: 'Brazil' }, parentsIncome: 'true' },
          true,
        ],
      ])('is marked qualified or not: %s', async (what, extra, qualified) => {
        const res = await request(app).post('/v1/leads').send(incoming(extra)).expect(httpStatus.CREATED);

        expect(!!(await stored(res.body)).qualified).toBe(qualified);
      });
    });

    describe('changing one', () => {
      test('staff change its status and details', async () => {
        const lead = leadWith('New', false);

        await as(u.staff)
          .patch(`/v1/leads/${lead._id}`, { status: 'Sent Whatsapp', city: 'Seedville' })
          .expect(httpStatus.OK);

        expect(await stored(lead)).toMatchObject({ status: 'Sent Whatsapp', city: 'Seedville' });
      });

      test('a status the model does not know is refused', async () => {
        const lead = leadWith('New', false);

        await as(u.staff).patch(`/v1/leads/${lead._id}`, { status: 'Vanished' }).expect(httpStatus.BAD_REQUEST);

        expect((await stored(lead)).status).toBe('New');
      });

      test('one that does not exist is 404', async () => {
        await as(u.staff).patch('/v1/leads/5eed00090000000000ffffff', { city: 'Seedville' }).expect(httpStatus.NOT_FOUND);
        await as(u.staff).get('/v1/leads/5eed00090000000000ffffff').expect(httpStatus.NOT_FOUND);
      });
    });

    describe('assigning one', () => {
      test('gives it to a member of the team and records when', async () => {
        const lead = leadWith('New', false);

        await as(u.staff)
          .post(`/v1/leads/${lead._id}/assign`, { userId: String(u.counsellorA._id) })
          .expect(httpStatus.OK);

        const now = await stored(lead);
        expect(String(now.assignedTo)).toBe(String(u.counsellorA._id));
        expect(now.assignedAt.getTime()).toBeGreaterThanOrEqual(startedAt);
      });

      test('needs somebody who exists', async () => {
        const lead = leadWith('New', false);

        await as(u.staff)
          .post(`/v1/leads/${lead._id}/assign`, { userId: '5eed00020000000000ffffff' })
          .expect(httpStatus.BAD_REQUEST);
        await as(u.staff).post(`/v1/leads/${lead._id}/assign`, { userId: 'not-an-id' }).expect(httpStatus.BAD_REQUEST);
        await as(u.staff).post(`/v1/leads/${lead._id}/assign`, {}).expect(httpStatus.BAD_REQUEST);

        expect((await stored(lead)).assignedTo).toBeUndefined();
      });

      test('a lead that does not exist is 404', async () => {
        await as(u.staff)
          .post('/v1/leads/5eed00090000000000ffffff/assign', { userId: String(u.counsellorA._id) })
          .expect(httpStatus.NOT_FOUND);
      });
    });

    describe('setting a follow-up', () => {
      test('records the date on the lead and makes a reminder for whoever it is assigned to', async () => {
        const lead = leadWith('New', true);

        await as(u.counsellorA)
          .post(`/v1/leads/${lead._id}/follow-up`, { dueDate: '2026-03-01T09:00:00.000Z', note: 'Seed note: call back.' })
          .expect(httpStatus.OK);

        expect((await stored(lead)).nextFollowUp.toISOString()).toBe('2026-03-01T09:00:00.000Z');
        const reminders = await Reminder.find({ lead: lead._id }).lean();
        expect(reminders).toHaveLength(1);
        expect(reminders[0]).toMatchObject({
          type: 'follow-up',
          note: 'Seed note: call back.',
          title: `Follow up with ${lead.fullname}`,
        });
        expect(String(reminders[0].user)).toBe(String(lead.assignedTo));
        expect(String(reminders[0].createdBy)).toBe(String(u.counsellorA._id));
      });

      test('a second follow-up moves the same reminder, it does not add another', async () => {
        const lead = leadWith('New', true);

        await as(u.staff)
          .post(`/v1/leads/${lead._id}/follow-up`, { dueDate: '2026-03-01T09:00:00.000Z', note: 'first' })
          .expect(httpStatus.OK);
        await as(u.staff)
          .post(`/v1/leads/${lead._id}/follow-up`, { dueDate: '2026-03-08T09:00:00.000Z' })
          .expect(httpStatus.OK);

        const reminders = await Reminder.find({ lead: lead._id }).lean();
        expect(reminders).toHaveLength(1);
        expect(reminders[0].dueDate.toISOString()).toBe('2026-03-08T09:00:00.000Z');
        expect(reminders[0].note).toBe('first');
      });

      test('on a lead nobody is assigned to, the reminder is for whoever set it', async () => {
        const lead = leadWith('New', false);

        await as(u.counsellorB)
          .post(`/v1/leads/${lead._id}/follow-up`, { dueDate: '2026-03-01T09:00:00.000Z' })
          .expect(httpStatus.OK);

        const [reminder] = await Reminder.find({ lead: lead._id }).lean();
        expect(String(reminder.user)).toBe(String(u.counsellorB._id));
      });

      test('needs a date', async () => {
        const lead = leadWith('New', true);

        await as(u.staff).post(`/v1/leads/${lead._id}/follow-up`, {}).expect(httpStatus.BAD_REQUEST);
        await as(u.staff).post(`/v1/leads/${lead._id}/follow-up`, { dueDate: 'next week' }).expect(httpStatus.BAD_REQUEST);

        expect(await Reminder.countDocuments({ lead: lead._id })).toBe(0);
      });
    });

    describe('turning a lead into a student', () => {
      test('makes the student from the lead, assigned as the lead was, and marks the lead converted', async () => {
        const lead = leadWith('Applied', true);

        const res = await as(u.counsellorA).post(`/v1/leads/${lead._id}/convert`).expect(httpStatus.CREATED);

        const [first, ...rest] = lead.fullname.split(' ');
        const student = await Students.findById(res.body.id || res.body._id).lean();
        expect(student).toMatchObject({
          firstName: first,
          lastName: rest.join(' '),
          email: lead.email,
          phoneNo: lead.phoneNo,
          channel: 'lead',
          stage: 'NotApplied',
          source: lead.source,
        });
        expect(String(student.createdBy)).toBe(String(u.counsellorA._id));
        expect(student.assignedTo).toHaveLength(1);
        expect(student.assignedTo[0]).toMatchObject({ role: 'sales' });
        expect(String(student.assignedTo[0].user)).toBe(String(lead.assignedTo));

        const now = await stored(lead);
        expect(now.status).toBe('Converted');
        expect(String(now.convertedStudentId)).toBe(String(student._id));
        expect(now.convertedAt.getTime()).toBeGreaterThanOrEqual(startedAt);
      });

      test('a lead nobody is assigned to becomes a student nobody is assigned to', async () => {
        const lead = leadWith('Applied', false);

        const res = await as(u.staff).post(`/v1/leads/${lead._id}/convert`).expect(httpStatus.CREATED);

        expect((await Students.findById(res.body.id || res.body._id).lean()).assignedTo).toEqual([]);
      });

      test('a follow-up set on the lead carries over to the student', async () => {
        const lead = leadWith('Applied', true);
        await as(u.staff)
          .post(`/v1/leads/${lead._id}/follow-up`, { dueDate: '2026-03-01T09:00:00.000Z' })
          .expect(httpStatus.OK);

        const res = await as(u.staff).post(`/v1/leads/${lead._id}/convert`).expect(httpStatus.CREATED);

        const [reminder] = await Reminder.find({ lead: lead._id }).lean();
        expect(String(reminder.student)).toBe(String(res.body.id || res.body._id));
      });

      test('cannot be done twice', async () => {
        const lead = leadWith('Applied', true);
        await as(u.staff).post(`/v1/leads/${lead._id}/convert`).expect(httpStatus.CREATED);
        const students = await Students.countDocuments();

        await as(u.staff).post(`/v1/leads/${lead._id}/convert`).expect(httpStatus.BAD_REQUEST);
        // The seed's own converted lead already points at a student.
        await as(u.staff)
          .post(`/v1/leads/${leadWith('Converted', true)._id}/convert`)
          .expect(httpStatus.BAD_REQUEST);

        expect(await Students.countDocuments()).toBe(students);
      });

      test("is refused when a student already has the lead's e-mail address", async () => {
        const lead = leadWith('Applied', true);
        await Leads.updateOne({ _id: lead._id }, { $set: { email: seed.students[0].email } });

        await as(u.staff).post(`/v1/leads/${lead._id}/convert`).expect(httpStatus.BAD_REQUEST);

        expect((await stored(lead)).status).toBe('Applied');
        expect(await Students.countDocuments()).toBe(seed.students.length);
      });

      test('needs a signed-in member of staff', async () => {
        const lead = leadWith('Applied', true);

        await request(app).post(`/v1/leads/${lead._id}/convert`).expect(httpStatus.UNAUTHORIZED);
        await as(u.subAgentA).post(`/v1/leads/${lead._id}/convert`).expect(httpStatus.FORBIDDEN);
        await as(u.schoolA).post(`/v1/leads/${lead._id}/convert`).expect(httpStatus.FORBIDDEN);

        expect((await stored(lead)).status).toBe('Applied');
      });
    });

    describe('deleting one', () => {
      test('an admin can, and it is gone', async () => {
        const lead = leadWith('New', false);

        await as(u.admin).delete(`/v1/leads/${lead._id}`).expect(httpStatus.NO_CONTENT);

        expect(await stored(lead)).toBeNull();
      });

      test('other staff cannot', async () => {
        const lead = leadWith('New', false);

        await as(u.staff).delete(`/v1/leads/${lead._id}`).expect(httpStatus.FORBIDDEN);
        await as(u.reviewer).delete(`/v1/leads/${lead._id}`).expect(httpStatus.FORBIDDEN);

        expect(await stored(lead)).not.toBeNull();
      });
    });

    test('search finds a lead by name, and treats what is typed as plain text', async () => {
      const lead = seed.leads[0];

      const byName = await as(u.staff)
        .get(`/v1/leads/search/${encodeURIComponent(lead.fullname)}?limit=100`)
        .expect(httpStatus.OK);
      const pattern = await as(u.staff)
        .get(`/v1/leads/search/${encodeURIComponent('.*')}?limit=100`)
        .expect(httpStatus.OK);

      expect(idsOf(byName.body.results)).toContain(String(lead._id));
      expect(pattern.body.results).toEqual([]);
    });
  });

  describe('the company goals', () => {
    // What the seed makes of 2025, worked out by hand from tests/seed/buildSeed.js:
    //  applied   6  students with a first application that is past review: four of staff's, one sub-agent's, one school's
    //  offers    5  of those, the ones enrolled or with an application at Conditional offer or beyond
    //  enrolled  2  the two staff students at Enrolled
    //  revenue 103  the office fee dated 31 December 2025
    const LAST_YEAR = { applied: 6, offers: 5, enrolled: 2, revenue: 103 };
    const LAST_SPLIT = { counselors: 4, subagents: 1, schools: 1 };

    test('before any are set, a year is given suggested goals: last year plus a tenth', async () => {
      const res = await as(u.staff).get('/v1/goals/2026').expect(httpStatus.OK);

      expect(res.body).toMatchObject({
        year: 2026,
        isSet: false,
        last: LAST_YEAR,
        lastSplit: LAST_SPLIT,
        // So far in 2026: no first applications, and the office fee dated 1 January.
        sofar: { applied: 0, offers: 0, enrolled: 0, revenue: 104 },
        // A tenth more, rounded; revenue to the nearest hundred.
        goal: { applied: 7, offers: 6, enrolled: 2, revenue: 100 },
        // The applied goal shared out as last year's was.
        split: { counselors: 5, subagents: 1, schools: 1 },
        updatedAt: null,
      });
    });

    test('an admin sets them, and they are then what is read', async () => {
      const goals = {
        goal: { applied: 40, offers: 30, enrolled: 12.4, revenue: 50000 },
        split: { counselors: 25, subagents: 10, schools: 5 },
      };

      const saved = await as(u.admin).put('/v1/goals/2026', goals).expect(httpStatus.OK);
      const read = await as(u.staff).get('/v1/goals/2026').expect(httpStatus.OK);

      expect(saved.body).toMatchObject({
        isSet: true,
        goal: { applied: 40, offers: 30, enrolled: 12, revenue: 50000 },
        split: goals.split,
      });
      expect(read.body.goal).toEqual(saved.body.goal);
      expect(read.body.last).toEqual(LAST_YEAR);
      const doc = await Goal.findOne({ year: 2026 }).lean();
      expect(String(doc.updatedBy)).toBe(String(u.admin._id));
    });

    test('setting them again replaces them: one record a year', async () => {
      const goals = (applied) => ({
        goal: { applied, offers: 1, enrolled: 1, revenue: 1 },
        split: { counselors: 1, subagents: 0, schools: 0 },
      });

      await as(u.admin).put('/v1/goals/2026', goals(10)).expect(httpStatus.OK);
      await as(u.admin).put('/v1/goals/2026', goals(20)).expect(httpStatus.OK);

      expect(await Goal.countDocuments({ year: 2026 })).toBe(1);
      expect((await Goal.findOne({ year: 2026 }).lean()).goal.applied).toBe(20);
    });

    test('a goal that is negative, missing or not a number is refused, and nothing is saved', async () => {
      const good = {
        goal: { applied: 1, offers: 1, enrolled: 1, revenue: 1 },
        split: { counselors: 1, subagents: 0, schools: 0 },
      };

      await as(u.admin)
        .put('/v1/goals/2026', { ...good, goal: { ...good.goal, applied: -1 } })
        .expect(httpStatus.BAD_REQUEST);
      await as(u.admin)
        .put('/v1/goals/2026', { ...good, split: { counselors: 'many', subagents: 0, schools: 0 } })
        .expect(httpStatus.BAD_REQUEST);
      await as(u.admin).put('/v1/goals/2026', { goal: good.goal }).expect(httpStatus.BAD_REQUEST);

      expect(await Goal.countDocuments()).toBe(0);
    });

    test('a year that is not a year is refused', async () => {
      await as(u.staff).get('/v1/goals/soon').expect(httpStatus.BAD_REQUEST);
      await as(u.staff).get('/v1/goals/1999').expect(httpStatus.BAD_REQUEST);
      await as(u.staff).get('/v1/goals/2026.5').expect(httpStatus.BAD_REQUEST);
    });

    test('only an admin sets them; staff read them; partners and callers with no token do neither', async () => {
      const goals = {
        goal: { applied: 1, offers: 1, enrolled: 1, revenue: 1 },
        split: { counselors: 1, subagents: 0, schools: 0 },
      };

      await as(u.staff).put('/v1/goals/2026', goals).expect(httpStatus.FORBIDDEN);
      await as(u.reviewer).put('/v1/goals/2026', goals).expect(httpStatus.FORBIDDEN);
      await as(u.subAgentA).get('/v1/goals/2026').expect(httpStatus.FORBIDDEN);
      await as(u.schoolA).get('/v1/goals/2026').expect(httpStatus.FORBIDDEN);
      await request(app).get('/v1/goals/2026').expect(httpStatus.UNAUTHORIZED);
      await request(app).put('/v1/goals/2026').send(goals).expect(httpStatus.UNAUTHORIZED);

      expect(await Goal.countDocuments()).toBe(0);
    });
  });

  // How things are today, not how they are meant to be. None of these lets
  // anybody see or change what they should not. When one is changed, its test
  // fails and is rewritten to say what is then true.
  describe('not as one would expect yet', () => {
    test('reading one fee by its id always answers 404, although the fee exists', async () => {
      const fee = seed.fees[0];
      expect(await Fees.findById(fee._id).lean()).not.toBeNull();

      await as(u.staff).get(`/v1/fees/${fee._id}`).expect(httpStatus.NOT_FOUND);
    });

    describe('a lead coming in with a part missing', () => {
      const incoming = (missing) => {
        const body = {
          fullname: 'Rana Testwell',
          email: 'new.lead@example.com',
          phoneNo: '+96509900002',
          nationality: { english_name: 'Brazil' },
          residence: { english_name: 'Kuwait' },
          destination: { en_name: 'UK' },
          degree: { en_name: 'Bachelor' },
          countriesTraveled: [],
        };
        // eslint-disable-next-line security/detect-object-injection
        delete body[missing];
        return body;
      };

      test.each(['residence', 'degree'])('without %s it is answered 500, and is stored all the same', async (missing) => {
        await request(app).post('/v1/leads').send(incoming(missing)).expect(httpStatus.INTERNAL_SERVER_ERROR);

        expect(await Leads.countDocuments()).toBe(seed.leads.length + 1);
      });

      test('without nationality it is answered 500, and is not stored', async () => {
        await request(app).post('/v1/leads').send(incoming('nationality')).expect(httpStatus.INTERNAL_SERVER_ERROR);

        expect(await Leads.countDocuments()).toBe(seed.leads.length);
      });
    });
  });

  test('none of this tried to reach anything outside the machine', () => {
    expect(blocked).toEqual([]);
  });
});
