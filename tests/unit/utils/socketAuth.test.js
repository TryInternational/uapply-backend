/**
 * A socket is only ever in the room of the user its token belongs to.
 * Before this, any client could `subscribe` with someone else's id and read
 * their notifications and WhatsApp events.
 */
const jwt = require('jsonwebtoken');
const { socketAuth, joinOwnRoom, UNAUTHORIZED } = require('../../../src/utils/socketAuth');

const SECRET = 'test-only-secret';
const USER_ID = '64b000000000000000000001';
const OTHER_ID = '64b000000000000000000002';

const tokenFor = (sub, type = 'access', expiresInSec = 600, secret = SECRET) =>
  jwt.sign({ sub, type, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + expiresInSec }, secret);

const socketWith = (handshake) => ({ handshake, join: jest.fn() });

const run = async (socket, findUser = async () => ({ _id: USER_ID })) => {
  const next = jest.fn();
  await socketAuth({ secret: SECRET, findUser, logger: { warn: jest.fn() } })(socket, next);
  return next;
};

const refused = (next) => {
  expect(next).toHaveBeenCalledTimes(1);
  expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
  expect(next.mock.calls[0][0].message).toBe(UNAUTHORIZED);
};

describe('socketAuth', () => {
  test('a valid access token is let in and the socket remembers whose it is', async () => {
    const socket = socketWith({ auth: { token: tokenFor(USER_ID) } });
    const next = await run(socket);
    expect(next).toHaveBeenCalledWith();
    expect(socket.data.userId).toBe(USER_ID);
  });

  test('a Bearer header works too', async () => {
    const socket = socketWith({ headers: { authorization: `Bearer ${tokenFor(USER_ID)}` } });
    const next = await run(socket);
    expect(next).toHaveBeenCalledWith();
    expect(socket.data.userId).toBe(USER_ID);
  });

  test('no token, an empty token or no handshake at all is refused', async () => {
    refused(await run(socketWith({})));
    refused(await run(socketWith({ auth: { token: '' } })));
    refused(await run(socketWith({ auth: { token: null } })));
    refused(await run({ join: jest.fn() }));
  });

  test('a token signed with another secret is refused', async () => {
    refused(await run(socketWith({ auth: { token: tokenFor(USER_ID, 'access', 600, 'someone-elses-secret') } })));
  });

  test('an expired token is refused', async () => {
    refused(await run(socketWith({ auth: { token: tokenFor(USER_ID, 'access', -60) } })));
  });

  test('a refresh or reset token is not an access token', async () => {
    refused(await run(socketWith({ auth: { token: tokenFor(USER_ID, 'refresh') } })));
    refused(await run(socketWith({ auth: { token: tokenFor(USER_ID, 'resetPassword') } })));
  });

  test('a deleted or closed account is refused, and so is a failed lookup', async () => {
    const socket = () => socketWith({ auth: { token: tokenFor(USER_ID) } });
    refused(await run(socket(), async () => null));
    refused(await run(socket(), async () => ({ _id: USER_ID, former: true })));
    refused(
      await run(socket(), async () => {
        throw new Error('database down');
      })
    );
  });

  test('a refused socket is never marked with a user', async () => {
    const socket = socketWith({ auth: { token: tokenFor(USER_ID, 'refresh') } });
    await run(socket);
    expect(socket.data).toBeUndefined();
  });
});

describe('joinOwnRoom', () => {
  const identified = () => ({ data: { userId: USER_ID }, join: jest.fn() });

  test('joins the room of the user the token belongs to', () => {
    const socket = identified();
    expect(joinOwnRoom(socket)).toBe(USER_ID);
    expect(socket.join).toHaveBeenCalledWith(USER_ID);
  });

  test("asking for someone else's room still joins only your own", () => {
    const socket = identified();
    const logger = { warn: jest.fn() };
    expect(joinOwnRoom(socket, OTHER_ID, logger)).toBe(USER_ID);
    expect(socket.join).toHaveBeenCalledTimes(1);
    expect(socket.join).toHaveBeenCalledWith(USER_ID);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  test('sending your own id is the normal case and is not logged as a problem', () => {
    const socket = identified();
    const logger = { warn: jest.fn() };
    joinOwnRoom(socket, USER_ID, logger);
    expect(socket.join).toHaveBeenCalledWith(USER_ID);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test('a socket that was never identified joins nothing', () => {
    const socket = { join: jest.fn() };
    expect(joinOwnRoom(socket, OTHER_ID)).toBeUndefined();
    expect(socket.join).not.toHaveBeenCalled();
  });
});
