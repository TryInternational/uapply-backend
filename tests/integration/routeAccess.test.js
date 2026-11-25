const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../../src/app');
const { User } = require('../../src/models');
const setupTestDB = require('../utils/setupTestDB');
const { listRoutes } = require('../utils/listRoutes');
const { blocked } = require('../utils/blockNetwork');
const { userOne, admin, subAgent, schoolCounselor, userWithNoRole, insertUsers } = require('../fixtures/user.fixture');
const { accessTokenFor } = require('../fixtures/token.fixture');

// Rate limits are switched off in this file only. They count calls from one
// address; they do not decide who a caller is. Left on, the fourth caller here
// gets "too many requests" from a route the first three reached, and the cell
// would record the order of the callers instead of the route's gate.
jest.mock('express-rate-limit', () => () => (req, res, next) => next());

/**
 * Which routes answer which kind of caller?
 *
 * This calls every route the app registers under /v1 once for each kind of
 * caller below, and compares what it finds with the matrix in
 * tests/fixtures/routeAccessMatrix.json. Each cell is "answers" or "refused".
 *
 *  - A cell that differs from the matrix fails the test. So a route cannot be
 *    opened to a kind of caller by accident, and cannot be closed without the
 *    matrix being brought up to date: either way the change shows up in a
 *    diff a reviewer reads.
 *
 * The matrix records how things are. It is not a statement that every
 * "answers" in it is meant to be one.
 *
 * "Refused" means 401 or 403. Anything else (200, 400, 404, 500, no answer in
 * time) means the request got past the gates, whatever happened next.
 *
 * What this does not show: whether a caller who gets past the gates then sees
 * only their own records. Every id in these requests is made up and matches
 * nothing, so ownership checks inside a handler are not exercised here.
 *
 * It is safe to call everything: the database is the throw-away one, outside
 * services are stand-ins, and outside network calls are blocked.
 *
 * To rewrite the matrix after a deliberate change:
 *   UPDATE_ROUTE_MATRIX=1 npx jest tests/integration/routeAccess.test.js
 * To write the status each route gave each caller to a file, for a review:
 *   ROUTE_ACCESS_REPORT=/some/path.json npx jest tests/integration/routeAccess.test.js
 */

const MATRIX_FILE = path.join(__dirname, '../fixtures/routeAccessMatrix.json');
const REFUSED = [401, 403];
const SWEEP_TIMEOUT_MS = 15 * 60 * 1000;

// The kinds of caller, in the order of the matrix's columns.
const CALLERS = [
  { key: 'noToken', user: null },
  // What POST /v1/auth/register makes: signed in, with no role.
  { key: 'noRole', user: userWithNoRole },
  { key: 'staff', user: userOne },
  { key: 'subAgent', user: subAgent },
  { key: 'schoolCounselor', user: schoolCounselor },
  { key: 'admin', user: admin },
];
const USERS = CALLERS.map((caller) => caller.user).filter(Boolean);

setupTestDB();

const { routes: allRoutes, unreadable } = listRoutes(app);
const routes = allRoutes.filter((route) => route.path === '/v1' || route.path.startsWith('/v1/'));

// A path with its parameters filled in: ":studentId" becomes a well-formed id
// that matches nothing, and an optional parameter is left out.
const urlFor = (routePath) =>
  routePath
    .replace(/\/:[A-Za-z0-9_]+\?/g, '')
    .replace(/:[A-Za-z0-9_]+/g, () => mongoose.Types.ObjectId().toHexString())
    .replace(/\*/g, 'x');

const readMatrix = () => JSON.parse(fs.readFileSync(MATRIX_FILE, 'utf8'));

describe('which routes answer which kind of caller', () => {
  let server;
  const statuses = {}; // route -> { caller: status }

  const callEveryRoute = async (caller) => {
    // Something an earlier call did must not change who this caller is.
    await User.deleteMany({ _id: { $in: USERS.map((user) => user._id) } });
    await insertUsers(USERS);
    const token = caller.user ? accessTokenFor(caller.user) : null;

    // One at a time, in the order Express holds them.
    // eslint-disable-next-line no-restricted-syntax
    for (const route of routes) {
      const method = route.method === 'ALL' ? 'get' : route.method.toLowerCase();
      let call = request(server)
        [method](urlFor(route.path))
        .set('Accept', 'application/json')
        .timeout({ response: 5000, deadline: 6000 });
      if (token) call = call.set('Authorization', `Bearer ${token}`);
      let status;
      try {
        // eslint-disable-next-line no-await-in-loop
        const res = await (['post', 'put', 'patch'].includes(method) ? call.send({}) : call);
        status = res.status;
      } catch (error) {
        status = error.timeout ? 'no answer in time' : `error: ${error.code || error.message}`;
      }
      const name = `${route.method} ${route.path}`;
      statuses[name] = statuses[name] || {};
      statuses[name][caller.key] = status;
    }
  };

  beforeAll(async () => {
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => {
      server.once('listening', resolve);
    });
    // eslint-disable-next-line no-restricted-syntax
    for (const caller of CALLERS) {
      // eslint-disable-next-line no-await-in-loop
      await callEveryRoute(caller);
    }
    if (process.env.ROUTE_ACCESS_REPORT) {
      // The path is chosen by whoever runs the test, on their own machine.
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      fs.writeFileSync(
        process.env.ROUTE_ACCESS_REPORT,
        `${JSON.stringify({ statuses, blockedOutsideCalls: blocked }, null, 2)}\n`
      );
    }
  }, SWEEP_TIMEOUT_MS);

  afterAll(async () => {
    await new Promise((resolve) => {
      server.close(resolve);
    });
  });

  // { "GET /v1/users": { noToken: "answers", ..., admin: "answers" }, ... } with routes in name order.
  const matrixNow = () => {
    const matrix = {};
    Object.keys(statuses)
      .sort()
      .forEach((route) => {
        matrix[route] = {};
        CALLERS.forEach(({ key }) => {
          matrix[route][key] = REFUSED.includes(statuses[route][key]) ? 'refused' : 'answers';
        });
      });
    return matrix;
  };

  test('every route could be read from the app', () => {
    expect(unreadable).toEqual([]);
    expect(routes.length).toBeGreaterThan(100);
  });

  test('every route answers each kind of caller as the matrix says', () => {
    const now = matrixNow();
    if (process.env.UPDATE_ROUTE_MATRIX) {
      fs.writeFileSync(MATRIX_FILE, `${JSON.stringify(now, null, 2)}\n`);
    }
    const expected = readMatrix();
    const differences = [];
    [...new Set([...Object.keys(now), ...Object.keys(expected)])].sort().forEach((route) => {
      if (!expected[route]) differences.push(`${route}: not in the matrix`);
      else if (!now[route]) differences.push(`${route}: in the matrix, but the app no longer has it`);
      else {
        CALLERS.forEach(({ key }) => {
          if (now[route][key] !== expected[route][key]) {
            differences.push(`${route} as ${key}: ${now[route][key]} (the matrix says ${expected[route][key]})`);
          }
        });
      }
    });
    expect(differences).toEqual([]);
  });

  test('an admin is refused nowhere that an ordinary member of staff is let in', () => {
    const matrix = matrixNow();
    const odd = Object.keys(matrix).filter(
      (route) => matrix[route].staff === 'answers' && matrix[route].admin === 'refused'
    );
    expect(odd).toEqual([]);
  });

  test('the matrix has a cell for every kind of caller on every route', () => {
    const expected = readMatrix();
    const keys = CALLERS.map((caller) => caller.key);
    Object.keys(expected).forEach((route) => {
      expect(Object.keys(expected[route])).toEqual(keys);
    });
    expect(Object.keys(expected)).toEqual(Object.keys(expected).slice().sort());
  });
});
