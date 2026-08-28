const httpStatus = require('http-status');
const ApiError = require('../utils/ApiError');
const ulearnStudentService = require('../services/ulearnStudent.service');

/**
 * Auth middleware for the ulearn-students service.
 *
 * Deliberately separate from middlewares/auth.js: that one is passport-JWT
 * bound to the back-office User model. Ulearn students authenticate with the
 * service's own JWT (issued after Google ID-token verification), so this
 * verifies that token and loads req.ulearnStudent.
 */

const getBearerToken = (req) => {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
};

/** Required auth: 401 when the token is missing or invalid. */
const ulearnStudentAuth = () => async (req, res, next) => {
  try {
    const token = getBearerToken(req);
    if (!token) {
      throw new ApiError(httpStatus.UNAUTHORIZED, 'Please authenticate');
    }
    req.ulearnStudent = await ulearnStudentService.getStudentFromJwt(token);
    next();
  } catch (err) {
    next(err);
  }
};

/**
 * Optional auth: attaches req.ulearnStudent when a valid token is present,
 * silently continues anonymously otherwise. Used by the three test-creation
 * endpoints so anonymous test-taking keeps working unchanged.
 */
const optionalUlearnStudentAuth = () => async (req, res, next) => {
  try {
    const token = getBearerToken(req);
    if (token) {
      req.ulearnStudent = await ulearnStudentService.getStudentFromJwt(token);
    }
  } catch (err) {
    // invalid/expired token on an optional route → treat as anonymous
    req.ulearnStudent = undefined;
  }
  next();
};

module.exports = { ulearnStudentAuth, optionalUlearnStudentAuth };
