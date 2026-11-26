/**
 * Serve the API to a browser, on the throw-away in-memory MongoDB filled with
 * the fixed seed. For the front end's browser tests (uapply-crm/e2e) and for
 * looking at the application by hand with made-up data.
 *
 *   node tests/e2e/serveSeed.js            listens on http://127.0.0.1:3999
 *   node tests/e2e/serveSeed.js 4010       or on the port given
 *
 * It is the test suite's own set-up, run as a server:
 *   - the settings are the throw-away ones of tests/utils/testEnv.js, so no
 *     settings file is read and no real database, key or service is named;
 *   - nothing can leave this machine (tests/utils/blockNetwork.js);
 *   - mail, Slack, OpenAI and Firebase are the stand-ins of tests/mocks, taken
 *     from the same list jest.config.js uses;
 *   - the database is the in-memory one of tests/utils/setupTestDB.js, which
 *     refuses anything that is not on 127.0.0.1, and it is gone when this stops.
 *
 * It listens on 127.0.0.1 only. Besides the API under /v1 it answers one
 * address of its own, GET /__seed/accounts, with the made-up accounts a
 * browser test can sign in as. That address exists here and nowhere else.
 */
require('../utils/testEnv');
require('../utils/blockNetwork');

const path = require('path');
const http = require('http');
const Module = require('module');
const express = require('express');
const jestConfig = require('../../jest.config');

// The stand-ins for outside services, by the list jest.config.js keeps:
// { '^resend$': '<rootDir>/tests/mocks/resend.js', ... }
const ROOT = path.join(__dirname, '../..');
const standIns = new Map(
  Object.entries(jestConfig.moduleNameMapper).map(([pattern, file]) => [
    pattern.replace(/^\^/, '').replace(/\$$/, ''),
    file.replace('<rootDir>', ROOT),
  ])
);
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveWithStandIns(request, ...rest) {
  return standIns.has(request) ? standIns.get(request) : resolveFilename.call(this, request, ...rest);
};

// Loaded after the stand-ins are in place, so the application gets them.
const { startThrowAwayDB, stopThrowAwayDB } = require('../utils/setupTestDB');
const { loadSeed } = require('../seed/loadSeed');
const { PASSWORD } = require('../factories');
const app = require('../../src/app');

const HOST = '127.0.0.1';
const port = Number(process.argv[2] || process.env.E2E_API_PORT || 3999);

const say = (line) => process.stdout.write(`${line}\n`);

const main = async () => {
  await startThrowAwayDB();
  const seed = await loadSeed();

  const accounts = Object.entries(seed.users).map(([kind, user]) => ({ kind, name: user.name, email: user.email }));

  const outer = express();
  // The browser tests run on another port, so they ask across origins.
  outer.get('/__seed/accounts', (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.json({ password: PASSWORD, accounts });
  });
  outer.use(app);

  const server = http.createServer(outer);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, HOST, resolve);
  });

  say(`Serving the seed on http://${HOST}:${port}/v1`);
  say(`${accounts.length} made-up accounts, listed at http://${HOST}:${port}/__seed/accounts`);
  say('Everything here is thrown away when this stops. Stop it with Ctrl-C.');

  const stop = async () => {
    await new Promise((resolve) => {
      server.close(resolve);
    });
    await stopThrowAwayDB();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
};

main().catch(async (error) => {
  process.stderr.write(`${error.stack || error}\n`);
  await stopThrowAwayDB().catch(() => {});
  process.exit(1);
});
