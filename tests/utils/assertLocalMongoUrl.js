/**
 * The integration tests empty EVERY collection before each test
 * (setupTestDB.js). That is only ever acceptable on a database that lives on
 * this machine.
 *
 * The test database name is the configured MONGODB_URL with "-test" on the
 * end. With a hosted cluster that is still the real cluster, and when the URL
 * carries options ("...?retryWrites=true") the suffix lands in the options and
 * the database name does not change at all — the tests would then wipe the
 * database the app itself uses.
 *
 * So: refuse anything that is not a plain mongodb:// URL whose hosts are all
 * local. The message never repeats the URL, which holds a password.
 */
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

const SCHEME = 'mongodb://';

const hostsOf = (url) => {
  const text = String(url || '').trim();
  // mongodb+srv:// is a DNS seed list — always a remote cluster — so it does not match
  if (!text.toLowerCase().startsWith(SCHEME)) return [];
  // "user:pass@host1:27017,host2/db?options" -> the part before the first / or ?
  const authority = text.slice(SCHEME.length).split('/')[0].split('?')[0];
  const hostList = authority.slice(authority.lastIndexOf('@') + 1);
  if (!hostList) return [];
  return hostList.split(',').map((host) => host.replace(/:\d+$/, '').toLowerCase());
};

const isLocalMongoUrl = (url) => {
  const hosts = hostsOf(url);
  return hosts.length > 0 && hosts.every((host) => LOCAL_HOSTS.includes(host));
};

const assertLocalMongoUrl = (url) => {
  if (!isLocalMongoUrl(url)) {
    throw new Error(
      'Refusing to run database tests: MONGODB_URL does not point at a MongoDB on this machine ' +
        '(localhost / 127.0.0.1). These tests delete every collection before each test. ' +
        'Start a local mongod, or use an in-memory one, and point MONGODB_URL at it.'
    );
  }
};

module.exports = { assertLocalMongoUrl, isLocalMongoUrl };
