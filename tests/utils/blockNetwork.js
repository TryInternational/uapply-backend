/**
 * No test may reach the outside world. Jest loads this before any test file
 * (setupFiles in jest.config.js) and it refuses every network connection that
 * does not stay on this machine.
 *
 * The mail, Slack, OpenAI and Firebase clients are replaced by stand-ins
 * (tests/mocks). This is the net under them: anything else that tries to
 * connect out — an axios call to WhatsApp or a payment provider, a fetch, a
 * client nobody thought to replace — fails here with a message that says so,
 * instead of sending something real.
 *
 * Allowed: this machine (supertest, the in-memory MongoDB), local sockets, and
 * the one host the in-memory MongoDB downloads its binary from the first time
 * it runs on a machine.
 */
const net = require('net');

const ALLOWED_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]', 'fastdl.mongodb.org']);

const blocked = [];

// net.connect() hands Socket.connect either the caller's own arguments or an
// array it has already normalised to [options, callback].
const targetOf = (args) => {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  if (first && typeof first === 'object') return first;
  if (typeof first === 'number' || /^\d+$/.test(String(first))) {
    return { port: Number(first), host: typeof args[1] === 'string' ? args[1] : 'localhost' };
  }
  return { path: String(first) };
};

const originalConnect = net.Socket.prototype.connect;

net.Socket.prototype.connect = function connect(...args) {
  const target = targetOf(args);
  const host = target.host || 'localhost';
  if (target.path || ALLOWED_HOSTS.has(String(host).toLowerCase())) {
    return originalConnect.apply(this, args);
  }
  const where = `${host}:${target.port}`;
  blocked.push(where);
  const error = new Error(
    `Blocked by tests/utils/blockNetwork.js: a test tried to connect to ${where}. ` +
      'Tests must not reach outside this machine. Replace the client with a stand-in (tests/mocks) or mock the call in the test.'
  );
  error.code = 'ENETWORKBLOCKED';
  process.nextTick(() => this.destroy(error));
  return this;
};

module.exports = { ALLOWED_HOSTS, blocked };
