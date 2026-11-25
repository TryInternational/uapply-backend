const request = require('supertest');
const httpStatus = require('http-status');
const app = require('../../src/app');
const setupTestDB = require('../utils/setupTestDB');
const { userOne, admin, subAgent, schoolCounselor, userWithNoRole, insertUsers } = require('../fixtures/user.fixture');
const { accessTokenFor } = require('../fixtures/token.fixture');

setupTestDB();

// The routers the office uses (fees, leads, quotes, WhatsApp and others) refuse
// an outside partner who presents a valid token. Both kinds of partner are
// refused. Nobody else is affected: staff get through, and so does a request
// with no token, because these routers also carry public webhooks.

describe('staff-only routers', () => {
  const get = (path, user) => {
    const call = request(app).get(path);
    return user ? call.set('Authorization', `Bearer ${accessTokenFor(user)}`) : call;
  };

  beforeEach(async () => {
    await insertUsers([userOne, admin, subAgent, schoolCounselor, userWithNoRole]);
  });

  describe.each(['/v1/fees', '/v1/leads', '/v1/quotes'])('GET %s', (path) => {
    test('refuses a sub-agent', async () => {
      await get(path, subAgent).expect(httpStatus.FORBIDDEN);
    });

    test('refuses a school counsellor', async () => {
      await get(path, schoolCounselor).expect(httpStatus.FORBIDDEN);
    });

    test('answers staff and admins', async () => {
      await get(path, userOne).expect(httpStatus.OK);
      await get(path, admin).expect(httpStatus.OK);
    });

    test('does not refuse a request with no token', async () => {
      const res = await get(path);
      expect(res.status).not.toBe(httpStatus.FORBIDDEN);
    });
  });

  describe('a user with no role', () => {
    test('cannot sign in', async () => {
      const res = await request(app)
        .post('/v1/auth/login')
        .send({ email: userWithNoRole.email, password: userWithNoRole.password })
        .expect(httpStatus.FORBIDDEN);

      expect(res.body).not.toHaveProperty('tokens');
    });

    test('is refused wherever a token is needed, even with a token that is otherwise good', async () => {
      await get('/v1/auth/me', userWithNoRole).expect(httpStatus.UNAUTHORIZED);
      await get('/v1/whatsapp/analytics/overview', userWithNoRole).expect(httpStatus.UNAUTHORIZED);
      await get('/v1/leads/facets', userWithNoRole).expect(httpStatus.UNAUTHORIZED);
    });
  });

  test('a partner is still let into what their own portal uses', async () => {
    await get('/v1/auth/me', subAgent).expect(httpStatus.OK);
    await get('/v1/auth/me', schoolCounselor).expect(httpStatus.OK);
    await get('/v1/application/mine', subAgent).expect(httpStatus.OK);
    await get('/v1/application/mine-school', schoolCounselor).expect(httpStatus.OK);
  });
});
