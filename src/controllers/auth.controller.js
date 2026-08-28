const httpStatus = require('http-status');
const catchAsync = require('../utils/catchAsync');
const { authService, userService, tokenService, emailService, roleAccessService } = require('../services');

/**
 * What the CRM is allowed to do, decided here and sent as booleans.
 *
 * The client used to hold the five role ObjectIds itself and compare them, so
 * recreating the roles broke the front end too and needed its own redeploy.
 * It now receives capabilities and never sees a role id, which means the
 * server is the only place that decides who may do what — and the only place
 * that has to be told when roles change.
 */
const withPermissions = (user) => ({
  ...(typeof user.toJSON === 'function' ? user.toJSON() : user),
  permissions: roleAccessService.permissionsFor(user),
});

const register = catchAsync(async (req, res) => {
  const user = await userService.createUser(req.body);
  const tokens = await tokenService.generateAuthTokens(user);
  res.status(httpStatus.CREATED).send({ user: withPermissions(user), tokens });
});

const login = catchAsync(async (req, res) => {
  const { email, password } = req.body;
  const user = await authService.loginUserWithEmailAndPassword(email, password);
  const tokens = await tokenService.generateAuthTokens(user);
  res.send({ user: withPermissions(user), tokens });
});

/**
 * GET /auth/me — the signed-in user and their current permissions.
 *
 * Permissions are computed per call, not baked into the token: a role change
 * takes effect on the next page load rather than on the next login, and a
 * revoked capability cannot be carried around inside a JWT until it expires.
 */
const me = catchAsync(async (req, res) => {
  res.send(withPermissions(req.user));
});

const logout = catchAsync(async (req, res) => {
  await authService.logout(req.body.refreshToken);
  res.status(httpStatus.NO_CONTENT).send();
});

const refreshTokens = catchAsync(async (req, res) => {
  const tokens = await authService.refreshAuth(req.body.refreshToken);
  res.send({ ...tokens });
});

const forgotPassword = catchAsync(async (req, res) => {
  const resetPasswordToken = await tokenService.generateResetPasswordToken(req.body.email);
  await emailService.sendResetPasswordEmail(req.body.email, resetPasswordToken);
  res.status(httpStatus.NO_CONTENT).send();
});

const resetPassword = catchAsync(async (req, res) => {
  await authService.resetPassword(req.body.token, req.body.password);
  res.status(httpStatus.NO_CONTENT).send();
});

const sendVerificationEmail = catchAsync(async (req, res) => {
  const verifyEmailToken = await tokenService.generateVerifyEmailToken(req.user);
  await emailService.sendVerificationEmail(req.user.email, verifyEmailToken);
  res.status(httpStatus.NO_CONTENT).send();
});

const verifyEmail = catchAsync(async (req, res) => {
  await authService.verifyEmail(req.query.token);
  res.status(httpStatus.NO_CONTENT).send();
});

module.exports = {
  me,
  register,
  login,
  logout,
  refreshTokens,
  forgotPassword,
  resetPassword,
  sendVerificationEmail,
  verifyEmail,
};
