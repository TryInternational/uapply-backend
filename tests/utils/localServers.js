/**
 * A server that a test starts listens on this machine's own address only.
 *
 * supertest starts a server for every request with `app.listen(0)`: any free
 * port, on every address. It then sends the request to 127.0.0.1 on that port.
 * On macOS the port handed out is, now and then, one that another program
 * already holds on 127.0.0.1 alone, because the two do not count as a clash.
 * The request then goes to the other program and not to the application: the
 * in-memory MongoDB hangs up on it ("socket hang up"), and another local web
 * server answers it 404. About one whole-suite run in ten failed a test or
 * three that way, a different test each time.
 *
 * A server asked for on 127.0.0.1 is never given a port that is held there, so
 * Jest loads this before any test file (setupFiles in jest.config.js) and
 * "any port, every address" becomes "any port, on 127.0.0.1". A server that
 * names its port or its address is left as it is.
 *
 * supertest reads the port straight after asking for the server, so the server
 * must be bound by the time `listen` returns. Node's own `listen(0, host)`
 * looks the host up first and binds a moment later, which is too late. The
 * step Node itself runs once it has an address, `_listen2`, binds at once, so
 * that is what is called here. It is an internal of Node: if a later version
 * drops it, this falls back to the ordinary `listen` and the test beside this
 * file (tests/unit/utils/localServers.test.js) fails and says so.
 */
const net = require('net');

const LOCAL = '127.0.0.1';
const IPV4 = 4;

const originalListen = net.Server.prototype.listen;

net.Server.prototype.listen = function listen(...args) {
  const anyPortOnEveryAddress = args[0] === 0 && typeof args[1] !== 'string';
  // eslint-disable-next-line no-underscore-dangle
  if (!anyPortOnEveryAddress || typeof this._listen2 !== 'function' || this._handle) {
    return originalListen.apply(this, args);
  }
  const whenListening = args.find((arg) => typeof arg === 'function');
  if (whenListening) this.once('listening', whenListening);
  const backlog = typeof args[1] === 'number' ? args[1] : undefined;
  // eslint-disable-next-line no-underscore-dangle
  this._listen2(LOCAL, 0, IPV4, backlog);
  return this;
};

module.exports = { LOCAL };
