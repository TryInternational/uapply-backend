const mongoose = require('mongoose');
const config = require('../../src/config/config');
const { assertLocalMongoUrl } = require('./assertLocalMongoUrl');

const setupTestDB = () => {
  // Checked here, as the test file loads, so nothing below is even registered
  // against a database that is not on this machine — and again before every
  // wipe, in case the connection was opened some other way.
  assertLocalMongoUrl(config.mongoose.url);

  beforeAll(async () => {
    assertLocalMongoUrl(config.mongoose.url);
    await mongoose.connect(config.mongoose.url, config.mongoose.options);
  });

  beforeEach(async () => {
    assertLocalMongoUrl(config.mongoose.url);
    await Promise.all(Object.values(mongoose.connection.collections).map(async (collection) => collection.deleteMany()));
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });
};

module.exports = setupTestDB;
