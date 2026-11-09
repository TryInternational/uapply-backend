const Joi = require('joi');

// E.164-ish: a leading "+" and 8–15 digits. The service re-parses it with
// utils/ulearnPhone and refuses unknown dial codes; this only stops junk early.
const phone = Joi.string()
  .trim()
  .pattern(/^\+[1-9]\d{7,14}$/)
  .required()
  .messages({ 'string.pattern.base': 'phone must be in international format, e.g. +96551234567' });

const otpFallbackStart = {
  body: Joi.object().keys({ phone }),
};

const otpFallbackCheck = {
  body: Joi.object().keys({
    phone,
    code: Joi.string()
      .trim()
      .pattern(/^\d{4,10}$/)
      .required(),
  }),
};

module.exports = {
  otpFallbackStart,
  otpFallbackCheck,
};
