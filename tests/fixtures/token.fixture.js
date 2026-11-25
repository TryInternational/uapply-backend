const { DateTime } = require('luxon');
const config = require('../../src/config/config');
const { tokenTypes } = require('../../src/config/tokens');
const tokenService = require('../../src/services/token.service');
const { userOne, admin } = require('./user.fixture');

const accessTokenExpires = DateTime.now().plus({ minutes: config.jwt.accessExpirationMinutes });
const accessTokenFor = (user) => tokenService.generateToken(user._id, accessTokenExpires, tokenTypes.ACCESS);

const userOneAccessToken = accessTokenFor(userOne);
const adminAccessToken = accessTokenFor(admin);

module.exports = {
  userOneAccessToken,
  adminAccessToken,
  accessTokenFor,
};
