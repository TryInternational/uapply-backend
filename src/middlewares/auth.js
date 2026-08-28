const passport = require('passport');
const httpStatus = require('http-status');
const ApiError = require('../utils/ApiError');
// const { roleRights } = require('../config/roles');
const roleService = require('../services/role.service');

const verifyCallback = (req, resolve, reject, requiredRights) => async (err, user, info) => {
  if (err || info || !user) {
    // "Please authenticate" is the right thing to SAY to a client, but it
    // collapses four very different causes into one string: a malformed or
    // wrongly-signed token, an expired one, a token of the wrong type, and a
    // valid token whose user does not exist in THIS service's database. Log
    // which it was — no token contents, just the reason — so a 401 can be
    // diagnosed from the server log instead of by guesswork.
    // eslint-disable-next-line no-console
    console.warn('auth: rejected', {
      path: req.originalUrl,
      reason: (info && (info.name || info.message)) || (err && err.message) || (!user ? 'no matching user for this token' : 'unknown'),
      hadAuthorizationHeader: Boolean(req.headers && req.headers.authorization),
    });
    return reject(new ApiError(httpStatus.UNAUTHORIZED, 'Please authenticate'));
  }
  req.user = user;

  if (requiredRights.length) {
    const userRights = await roleService.getRoleById(user.role);

    if (!userRights) {
      return reject(new ApiError(httpStatus.FORBIDDEN, 'Forbidden'));
    }
    const hasRequiredRights = requiredRights.every((requiredRight) => userRights.roleRights.includes(requiredRight));
    if (!hasRequiredRights && req.params.userId !== user.id) {
      return reject(new ApiError(httpStatus.FORBIDDEN, 'Forbidden'));
    }
  }

  resolve();
};

const auth =
  (...requiredRights) =>
  async (req, res, next) => {
    return new Promise((resolve, reject) => {
      passport.authenticate('jwt', { session: false }, verifyCallback(req, resolve, reject, requiredRights))(req, res, next);
    })
      .then(() => next())
      .catch((err) => next(err));
  };

module.exports = auth;
