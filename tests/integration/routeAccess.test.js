const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../../src/app');
const setupTestDB = require('../utils/setupTestDB');
const { listRoutes } = require('../utils/listRoutes');
const { blocked } = require('../utils/blockNetwork');

/**
 * Which routes answer a request that carries no token?
 *
 * This calls every route the app registers under /v1, once, with no
 * Authorization header, and compares the routes that do not refuse with the
 * list in tests/fixtures/routesOpenWithoutToken.json.
 *
 *  - A route that answers without a token and is not on the list fails the
 *    test. So a new route cannot be left open by accident: opening one means
 *    adding it to the list, where a reviewer sees it.
 *  - A route on the list that now refuses also fails the test, so the list is
 *    kept honest: take the route off when it is closed.
 *
 * The list records how things are. It is not a statement that every route on
 * it is meant to be open.
 *
 * "Refuses" means 401 or 403. Anything else (200, 400, 404, 500, no answer in
 * time) means the request got past the gates, whatever happened next.
 *
 * It is safe to call everything: the database is the throw-away one, outside
 * services are stand-ins, and outside network calls are blocked.
 *
 * To rewrite the list after a deliberate change:
 *   UPDATE_ROUTE_LIST=1 npx jest tests/integration/routeAccess.test.js
 * To write what each route answered to a file, for a review:
 *   ROUTE_ACCESS_REPORT=/some/path.json npx jest tests/integration/routeAccess.test.js
 */

const LIST_FILE = path.join(__dirname, '../fixtures/routesOpenWithoutToken.json');
const REFUSED = [401, 403];
const SWEEP_TIMEOUT_MS = 10 * 60 * 1000;

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

describe('routes that answer without a token', () => {
  let server;
  const answers = [];

  beforeAll(async () => {
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => {
      server.once('listening', resolve);
    });
    // One at a time, in the order Express holds them.
    // eslint-disable-next-line no-restricted-syntax
    for (const route of routes) {
      const method = route.method === 'ALL' ? 'get' : route.method.toLowerCase();
      let status;
      try {
        const call = request(server)
          [method](urlFor(route.path))
          .set('Accept', 'application/json')
          .timeout({ response: 5000, deadline: 6000 });
        // eslint-disable-next-line no-await-in-loop
        const res = await (['post', 'put', 'patch'].includes(method) ? call.send({}) : call);
        status = res.status;
      } catch (error) {
        status = error.timeout ? 'no answer in time' : `error: ${error.code || error.message}`;
      }
      answers.push({ route: `${route.method} ${route.path}`, status });
    }
    if (process.env.ROUTE_ACCESS_REPORT) {
      // The path is chosen by whoever runs the test, on their own machine.
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      fs.writeFileSync(
        process.env.ROUTE_ACCESS_REPORT,
        `${JSON.stringify({ answers, blockedOutsideCalls: blocked }, null, 2)}\n`
      );
    }
  }, SWEEP_TIMEOUT_MS);

  afterAll(async () => {
    await new Promise((resolve) => {
      server.close(resolve);
    });
  });

  const openNow = () => [...new Set(answers.filter((a) => !REFUSED.includes(a.status)).map((a) => a.route))].sort();

  test('every route could be read from the app', () => {
    expect(unreadable).toEqual([]);
    expect(routes.length).toBeGreaterThan(100);
  });

  test('no route answers without a token unless it is on the list', () => {
    if (process.env.UPDATE_ROUTE_LIST) {
      fs.writeFileSync(LIST_FILE, `${JSON.stringify(openNow(), null, 2)}\n`);
    }
    const listed = JSON.parse(fs.readFileSync(LIST_FILE, 'utf8'));
    expect(openNow().filter((route) => !listed.includes(route))).toEqual([]);
  });

  test('every route on the list still answers without a token', () => {
    const listed = JSON.parse(fs.readFileSync(LIST_FILE, 'utf8'));
    const open = openNow();
    expect(listed.filter((route) => !open.includes(route))).toEqual([]);
  });

  test('the list is sorted and has no duplicates', () => {
    const listed = JSON.parse(fs.readFileSync(LIST_FILE, 'utf8'));
    expect(listed).toEqual([...new Set(listed)].sort());
  });
});
