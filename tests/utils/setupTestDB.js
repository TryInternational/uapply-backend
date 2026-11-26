const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { assertLocalMongoUrl } = require('./assertLocalMongoUrl');

// The MongoDB version the throw-away server runs. It is stated here so that a
// new release of mongodb-memory-server cannot change it without a diff.
const MONGODB_VERSION = '7.0.14';
const DB_NAME = 'uapply-test';

// The first run on a machine downloads the MongoDB binary (it is kept under
// node_modules/.cache afterwards), so starting can take a while once.
const START_TIMEOUT_MS = 180000;

/**
 * Database tests run against a MongoDB that the test file starts for itself
 * and throws away when it finishes. It listens on 127.0.0.1 only and holds
 * nothing but what the tests put in it.
 *
 * MONGODB_URL plays no part here. These tests empty EVERY collection before
 * each test, so they must never be able to reach the database the settings
 * name, whatever those settings say.
 */

// The address of the throw-away server this test file started, once it has.
let uri;

// Wiping and seeding are only ever acceptable on the throw-away server. This
// checks the connection that is actually open, in case something else opened it.
const assertThrowAwayConnection = () => {
  const { host, port, name } = mongoose.connection;
  assertLocalMongoUrl(`mongodb://${host}:${port}/`);
  if (!uri || String(port) !== new URL(uri).port || name !== DB_NAME) {
    throw new Error('Refusing to run database tests: the open connection is not the in-memory test database.');
  }
};

// The throw-away server itself, kept here so that whoever started it stops it.
let server;

// mongodb-memory-server looks for a free port by listening on every address,
// then starts MongoDB on 127.0.0.1 alone. A port another program holds on
// 127.0.0.1 only passes that check, and MongoDB then cannot take it ("Port
// already in use"). It is rare and it is nobody's fault, so another port is
// tried.
const START_ATTEMPTS = 5;
const createServer = async (attempt = 1) => {
  try {
    return await MongoMemoryServer.create({
      instance: { ip: '127.0.0.1', dbName: DB_NAME },
      binary: { version: MONGODB_VERSION },
    });
  } catch (error) {
    if (attempt >= START_ATTEMPTS || !/already in use/i.test(String(error && error.message))) throw error;
    return createServer(attempt + 1);
  }
};

/** Start the throw-away MongoDB and connect to it. Resolves with its address. */
const startThrowAwayDB = async () => {
  if (mongoose.connection.readyState !== 0) {
    throw new Error('Refusing to run database tests: a database connection was already open before the tests started.');
  }
  server = await createServer();
  uri = server.getUri();
  assertLocalMongoUrl(uri);
  await mongoose.connect(uri, { dbName: DB_NAME });
  assertThrowAwayConnection();
  return uri;
};

/** Disconnect and throw the server away. */
const stopThrowAwayDB = async () => {
  await mongoose.disconnect();
  if (server) await server.stop();
  server = undefined;
  uri = undefined;
};

const setupTestDB = () => {
  beforeAll(startThrowAwayDB, START_TIMEOUT_MS);

  beforeEach(async () => {
    assertThrowAwayConnection();
    await Promise.all(Object.values(mongoose.connection.collections).map(async (collection) => collection.deleteMany()));
  });

  afterAll(stopThrowAwayDB);
};

module.exports = setupTestDB;
// For anything else that writes to the test database, such as the seed.
module.exports.assertThrowAwayConnection = assertThrowAwayConnection;
// For tests/e2e/serveSeed.js, which serves the same throw-away database to a browser.
module.exports.startThrowAwayDB = startThrowAwayDB;
module.exports.stopThrowAwayDB = stopThrowAwayDB;
