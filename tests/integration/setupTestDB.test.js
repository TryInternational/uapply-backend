const os = require('os');
const mongoose = require('mongoose');
const setupTestDB = require('../utils/setupTestDB');
const { isLocalMongoUrl } = require('../utils/assertLocalMongoUrl');

setupTestDB();

// A model that exists only for these tests.
const Thing = mongoose.models.SetupTestDbThing || mongoose.model('SetupTestDbThing', new mongoose.Schema({ name: String }));

describe('setupTestDB', () => {
  test('connects to a MongoDB on this machine', () => {
    const { host, port, readyState } = mongoose.connection;
    expect(readyState).toBe(1);
    expect(host).toBe('127.0.0.1');
    expect(isLocalMongoUrl(`mongodb://${host}:${port}/`)).toBe(true);
  });

  test('does not connect to the database the settings name', () => {
    // testEnv.js points MONGODB_URL at port 1, where nothing listens.
    expect(new URL(process.env.MONGODB_URL).port).toBe('1');
    expect(String(mongoose.connection.port)).not.toBe('1');
    expect(mongoose.connection.name).toBe('uapply-test');
  });

  test('no settings file is loaded during tests', () => {
    expect(process.env.ENV_FILE).toBe(os.devNull);
    expect(process.env.APP_ENV).toBeUndefined();
    expect(process.env.NODE_ENV).toBe('test');
  });

  test('a document written in one test', async () => {
    await Thing.create({ name: 'left behind' });
    expect(await Thing.countDocuments()).toBe(1);
  });

  test('is gone before the next test starts', async () => {
    expect(await Thing.countDocuments()).toBe(0);
  });
});
