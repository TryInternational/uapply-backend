const httpStatus = require('http-status');
const pick = require('../utils/pick');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');
const { userService } = require('../services');
const { isAdmin, isExternalPartner } = require('../middlewares/subAgentScope');
const Token = require('../models/token.model');
const { tokenTypes } = require('../config/tokens');

const createUser = catchAsync(async (req, res) => {
  const user = await userService.createUser(req.body);
  res.status(httpStatus.CREATED).send(user);
});

const getUsers = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['name', 'role']);
  const options = pick(req.query, ['sortBy', 'limit', 'page']);

  const result = await userService.queryUsers(filter, options);
  res.send(result);
});

const getUsersWithoutPagination = catchAsync(async (req, res) => {
  const result = await userService.getUsers();
  // A partner reads this for one thing: the @mention list in a student's
  // comment thread. They were being sent every user document in full — other
  // partners' accounts and organisation paperwork included, plus staff emails,
  // phone numbers and Slack ids. They get the Ulearn team only (a partner may
  // not tag another partner anyway — see comments.controller vetMentions), and
  // only what the list shows: who, and their role for the thread's filter.
  if (isExternalPartner(req.user)) {
    return res.send(
      result
        .filter((u) => !isExternalPartner(u) && !u.former)
        .map((u) => ({ id: String(u._id), name: u.name, role: u.role, avatar: u.avatar || '' }))
    );
  }
  res.send(result);
});

const getUser = catchAsync(async (req, res) => {
  const user = await userService.getUserById(req.params.userId);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
  }
  res.send(user);
});

const updateUser = catchAsync(async (req, res) => {
  // A role decides what someone can open, so only an admin may change it — and
  // not their own: an admin who demoted themselves would lock the door behind them.
  if (Object.prototype.hasOwnProperty.call(req.body, 'role')) {
    if (!isAdmin(req.user)) throw new ApiError(httpStatus.FORBIDDEN, 'Only an admin can change a role');
    if (req.user && String(req.user.id) === String(req.params.userId)) {
      throw new ApiError(httpStatus.BAD_REQUEST, "You can't change your own role");
    }
  }
  // stamp when a rating was given, so the team can read it in context
  if (Object.prototype.hasOwnProperty.call(req.body, 'rating')) req.body.ratedAt = new Date();
  // Closing an account (former staff) is an admin's call, and never your own.
  const closing = Object.prototype.hasOwnProperty.call(req.body, 'former');
  if (closing) {
    if (!isAdmin(req.user)) throw new ApiError(httpStatus.FORBIDDEN, 'Only an admin can close or reopen an account');
    if (req.user && String(req.user.id) === String(req.params.userId)) {
      throw new ApiError(httpStatus.BAD_REQUEST, "You can't close your own account");
    }
    req.body.formerAt = req.body.former ? new Date() : null;
  }
  const user = await userService.updateUserById(req.params.userId, req.body);
  // a closed account's sessions end now, not when its refresh tokens would have expired
  if (closing && req.body.former) await Token.deleteMany({ user: user.id, type: tokenTypes.REFRESH });
  res.send(user);
});

const deleteUser = catchAsync(async (req, res) => {
  if (req.user && String(req.user.id) === String(req.params.userId)) {
    throw new ApiError(httpStatus.BAD_REQUEST, "You can't delete your own account");
  }
  await userService.deleteUserById(req.params.userId);
  res.status(httpStatus.NO_CONTENT).send();
});

module.exports = {
  createUser,
  getUsers,
  getUser,
  updateUser,
  deleteUser,
  getUsersWithoutPagination,
};
