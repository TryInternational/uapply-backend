const request = require('supertest');
const httpStatus = require('http-status');
const mongoose = require('mongoose');
const app = require('../../src/app');
const setupTestDB = require('../utils/setupTestDB');
const { Leads, Reminder } = require('../../src/models');
const { loadSeed } = require('../seed/loadSeed');
const { accessTokenFor } = require('../fixtures/token.fixture');
const { blocked } = require('../utils/blockNetwork');

setupTestDB();

/**
 * The form on the website that somebody fills in to become a lead.
 *
 * It needs no token, so anybody can send it anything. What it may set is what
 * the visitor tells us about themselves. What staff decide about a lead
 * afterwards (its status, who works it, whether it is qualified, which student
 * it became) is not the form's to set, and is left out of what is stored.
 */
describe('the public lead form', () => {
  let seed;
  let u;

  const stored = (lead) => Leads.findById(lead.id || lead._id).lean();

  // Everything a visitor can tell us. Bound for the USA, so not qualified.
  const visitor = (extra = {}) => ({
    fullname: 'Rana Testwell',
    email: 'new.lead@example.com',
    phoneNo: '+96509900002',
    city: 'Salmiya',
    cgpa: '3.4',
    engLevel: 'Upper intermediate',
    iltesScore: '6.5',
    nationality: { english_name: 'Brazil' },
    residence: { english_name: 'Kuwait' },
    destination: { en_name: 'USA' },
    degree: { en_name: 'Bachelor' },
    subjects: 'Law, History',
    parentsIncome: 'false',
    previousSchool: 'A school in Kuwait',
    countriesTraveled: ['Turkey'],
    selectedUniversity: [{ name: 'A university' }],
    applications: [{ course: 'Law' }],
    sponsored: 'yes',
    sponsoredBy: 'Family',
    webUrl: 'https://example.com/apply',
    source: 'ulearn',
    ...extra,
  });

  beforeEach(async () => {
    seed = await loadSeed();
    u = seed.users;
  });

  test('stores everything the visitor tells us', async () => {
    const res = await request(app).post('/v1/leads').send(visitor()).expect(httpStatus.CREATED);

    expect(await stored(res.body)).toMatchObject({
      ...visitor(),
      phoneNo: '96509900002',
      parentsIncome: 'false',
    });
  });

  describe('what staff decide is not the form to set', () => {
    test('a lead cannot arrive with a status, an owner, a follow-up or a student already on it', async () => {
      const student = seed.students[0];
      const res = await request(app)
        .post('/v1/leads')
        .send(
          visitor({
            status: 'Converted',
            convertedStudentId: String(student._id),
            convertedAt: '2020-01-01T00:00:00.000Z',
            assignedTo: String(u.counsellorA._id),
            assignedAt: '2020-01-01T00:00:00.000Z',
            nextFollowUp: '2030-01-01T00:00:00.000Z',
          })
        )
        .expect(httpStatus.CREATED);

      const lead = await stored(res.body);
      expect(lead.status).toBe('New');
      expect(lead.convertedStudentId).toBeUndefined();
      expect(lead.convertedAt).toBeUndefined();
      expect(lead.assignedTo).toBeUndefined();
      expect(lead.assignedAt).toBeUndefined();
      expect(lead.nextFollowUp).toBeUndefined();
      expect(await Reminder.countDocuments({ lead: lead._id })).toBe(0);
    });

    test('a lead cannot mark itself qualified', async () => {
      const res = await request(app)
        .post('/v1/leads')
        .send(visitor({ qualified: true }))
        .expect(httpStatus.CREATED);

      expect(res.body.qualified).toBe(false);
      expect((await stored(res.body)).qualified).toBe(false);
    });

    test('nor mark itself not qualified when it is', async () => {
      const res = await request(app)
        .post('/v1/leads')
        .send(visitor({ nationality: { english_name: 'Kuwait' }, destination: { en_name: 'UK' }, qualified: false }))
        .expect(httpStatus.CREATED);

      expect((await stored(res.body)).qualified).toBe(true);
    });

    test('a password sent with the form is not kept', async () => {
      const res = await request(app)
        .post('/v1/leads')
        .send(visitor({ password: 'password1' }))
        .expect(httpStatus.CREATED);

      expect(res.body.password).toBeUndefined();
      expect((await stored(res.body)).password).toBeUndefined();
    });

    test('a password that would not be accepted does not get the form refused', async () => {
      await request(app)
        .post('/v1/leads')
        .send(visitor({ password: 'x' }))
        .expect(httpStatus.CREATED);
    });

    test('it cannot say its e-mail address is unverified, choose its own id, or date itself', async () => {
      const chosen = String(new mongoose.Types.ObjectId());
      const before = Date.now();
      const res = await request(app)
        .post('/v1/leads')
        .send(
          visitor({
            _id: chosen,
            id: chosen,
            isEmailVerified: false,
            createdAt: '2020-01-01T00:00:00.000Z',
            updatedAt: '2020-01-01T00:00:00.000Z',
          })
        )
        .expect(httpStatus.CREATED);

      expect(res.body.id).not.toBe(chosen);
      expect(await Leads.findById(chosen)).toBeNull();
      const lead = await stored(res.body);
      expect(lead.isEmailVerified).toBe(true);
      expect(lead.createdAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(lead.updatedAt.getTime()).toBeGreaterThanOrEqual(before);
    });

    test('a lead sent with those parts is still stored, with them left out', async () => {
      const count = await Leads.countDocuments();

      await request(app)
        .post('/v1/leads')
        .send(visitor({ status: 'Converted', qualified: true, assignedTo: String(u.staff._id) }))
        .expect(httpStatus.CREATED);

      expect(await Leads.countDocuments()).toBe(count + 1);
      expect(await Leads.countDocuments({ status: 'New', fullname: 'Rana Testwell' })).toBe(1);
    });
  });

  test('staff then do with it what the form could not', async () => {
    const res = await request(app).post('/v1/leads').send(visitor()).expect(httpStatus.CREATED);
    const staff = `Bearer ${accessTokenFor(u.staff)}`;

    await request(app)
      .post(`/v1/leads/${res.body.id}/assign`)
      .set('Authorization', staff)
      .send({ userId: String(u.counsellorA._id) })
      .expect(httpStatus.OK);
    await request(app)
      .patch(`/v1/leads/${res.body.id}`)
      .set('Authorization', staff)
      .send({ status: 'Sent Whatsapp' })
      .expect(httpStatus.OK);

    const lead = await stored(res.body);
    expect(String(lead.assignedTo)).toBe(String(u.counsellorA._id));
    expect(lead.status).toBe('Sent Whatsapp');
  });

  // How things are today, written down so a change shows up. When this is
  // changed, the test fails and is rewritten to say what is then true.
  describe('not as one would expect yet', () => {
    test('a visitor bound for the UK who answers no about family income is marked qualified all the same', async () => {
      const res = await request(app)
        .post('/v1/leads')
        .send(visitor({ destination: { en_name: 'UK' }, parentsIncome: 'false' }))
        .expect(httpStatus.CREATED);

      expect((await stored(res.body)).qualified).toBe(true);
    });
  });

  test('none of this tried to reach anything outside the machine', () => {
    expect(blocked).toEqual([]);
  });
});
