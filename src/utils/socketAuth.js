/**
 * Who is on the other end of a socket.
 *
 * The socket server used to accept any connection and let it `subscribe` to
 * any user id it named. Rooms are keyed by user id, and notifications and the
 * `wa:*` WhatsApp events are emitted to them — so anyone who could reach the
 * socket could read another person's notifications and chats by sending their
 * id. The id is not a secret: it is in every API answer that lists staff.
 *
 * Now the handshake must carry a valid ACCESS token (the CRM has always sent
 * it as `auth.token`), and a socket is only ever put in the room of the user
 * that token belongs to. The id a client sends with `subscribe` is ignored.
 *
 * Kept free of `config` and the models so it can be tested on its own: the
 * secret and the user lookup are handed in by src/index.js.
 */
const jwt = require('jsonwebtoken');
const { tokenTypes } = require('../config/tokens');

/** What a refused client sees in `connect_error`. The CRM matches on it. */
const UNAUTHORIZED = 'unauthorized';

const tokenFrom = (socket) => {
  const handshake = (socket && socket.handshake) || {};
  const fromAuth = handshake.auth && typeof handshake.auth.token === 'string' ? handshake.auth.token : '';
  const header = (handshake.headers && handshake.headers.authorization) || '';
  const fromHeader = /^Bearer\s+/i.test(header) ? header.replace(/^Bearer\s+/i, '') : '';
  return (fromAuth || fromHeader).trim();
};

/**
 * Socket.IO middleware: refuse the connection unless it presents a valid
 * access token for an account that still exists and is not closed.
 *
 * @param {Object} deps
 * @param {string} deps.secret - the JWT secret access tokens are signed with
 * @param {(id: string) => Promise<Object|null>} deps.findUser
 * @param {{warn: Function}} [deps.logger]
 */
const socketAuth =
  ({ secret, findUser, logger }) =>
  async (socket, next) => {
    const refuse = (reason) => {
      // the reason only — never the token
      if (logger) logger.warn(`socket: refused (${reason})`);
      next(new Error(UNAUTHORIZED));
    };

    const token = tokenFrom(socket);
    if (!token) return refuse('no token');

    let payload;
    try {
      payload = jwt.verify(token, secret);
    } catch (e) {
      return refuse(e.name || 'invalid token');
    }
    if (!payload || payload.type !== tokenTypes.ACCESS || !payload.sub) return refuse('not an access token');

    try {
      const user = await findUser(payload.sub);
      // same rule as the HTTP gate: a closed (former staff) account is out at once
      if (!user || user.former) return refuse('no such user');
    } catch (e) {
      return refuse('user lookup failed');
    }

    // eslint-disable-next-line no-param-reassign
    socket.data = { ...(socket.data || {}), userId: String(payload.sub) };
    return next();
  };

/**
 * Put the socket in its OWN user's room, whatever id the client asked for.
 * Returns the room joined (undefined for a socket that was never identified).
 */
const joinOwnRoom = (socket, requestedId, logger) => {
  const own = socket && socket.data && socket.data.userId;
  if (!own) return undefined;
  if (requestedId !== undefined && requestedId !== null && String(requestedId) !== own && logger) {
    logger.warn(`socket: user ${own} asked to subscribe as another user; ignored`);
  }
  socket.join(own);
  return own;
};

module.exports = { socketAuth, joinOwnRoom, tokenFrom, UNAUTHORIZED };
