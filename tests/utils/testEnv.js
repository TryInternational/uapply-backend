/**
 * Settings for a test run. Jest loads this before any test file (setupFiles in
 * jest.config.js), so it is in place before src/config/config.js is first read.
 *
 * Tests must not depend on, or be able to reach, anything a real settings file
 * names. So:
 *
 *  - No settings file is loaded. config.js reads ENV_FILE first; pointing it at
 *    the null device means dotenv finds nothing, whatever APP_ENV was in the
 *    shell that started the tests.
 *  - The two settings config.js insists on are given throw-away values. Neither
 *    reaches a real system: database tests connect to their own in-memory
 *    MongoDB (setupTestDB.js) and never to MONGODB_URL, which points at a port
 *    where nothing listens.
 *
 * Nothing here is a secret. Do not add a real key, token or URL to this file.
 */
const os = require('os');

process.env.ENV_FILE = os.devNull;
delete process.env.APP_ENV;
process.env.NODE_ENV = 'test';

process.env.MONGODB_URL = 'mongodb://127.0.0.1:1/not-used-by-tests';
process.env.JWT_SECRET = 'test-only-secret-not-used-anywhere-else';

// config.js calls .replace() on these two as it loads, so it cannot be read at
// all while they are missing. They are not keys: the Firebase client is a
// stand-in during tests (tests/mocks/firebase-admin.js) and never looks at them.
process.env.PRIVATE_KEY = 'not-a-key-placeholder-for-tests';
process.env.FIREBASE_PRIVATE_KEY = 'not-a-key-placeholder-for-tests';

// Which roles are the two kinds of outside partner is a setting, not something
// stored on the role. These ids exist only in tests; tests/fixtures/role.fixture.js
// makes the two roles with them.
process.env.SUB_AGENT_ROLE_ID = '64a000000000000000000001';
process.env.SCHOOL_COUNSELOR_ROLE_ID = '64a000000000000000000002';
