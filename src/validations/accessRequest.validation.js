const Joi = require('joi');
const { objectId } = require('./custom.validation');

// Joi rejects unknown keys by default, so a body carrying `status`, `user`,
// `decision` or a role id is a 400 before it ever reaches the controller.
const submitAccessRequest = {
  body: Joi.object().keys({
    // A role NAME, never a role id. These two keys are the only values the
    // server will map to a role, and neither maps to an internal one.
    requestedRole: Joi.string().valid('subAgent', 'schoolCounselor').required(),
    name: Joi.string().trim().min(2).max(120).required(),
    email: Joi.string().trim().lowercase().email().max(254).required(),
    phoneCode: Joi.string().trim().max(8).allow('', null),
    phone: Joi.string().trim().min(5).max(32).required(),
    organisation: Joi.string().trim().min(2).max(160).required(),
    country: Joi.string().trim().max(80).allow('', null),
    city: Joi.string().trim().max(80).allow('', null),
    website: Joi.string().trim().max(200).allow('', null),
    note: Joi.string().trim().max(1000).allow('', null),
  }),
};

const listAccessRequests = {
  query: Joi.object().keys({
    status: Joi.string().valid('Pending', 'Approved', 'Declined'),
    limit: Joi.number().integer().min(1).max(200),
  }),
};

const decideAccessRequest = {
  params: Joi.object().keys({
    // custom objectId, so a junk id is a 400 rather than a mongoose CastError
    // surfacing as a 500.
    requestId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    decision: Joi.string().valid('Approved', 'Declined').required(),
    // Required when declining; the controller enforces that, because Joi
    // cannot see the decision value from inside the reason rule cleanly here.
    reason: Joi.string().trim().max(1000).allow('', null),
  }),
};

const resendInvite = {
  params: Joi.object().keys({
    requestId: Joi.string().custom(objectId).required(),
  }),
};

module.exports = {
  submitAccessRequest,
  listAccessRequests,
  decideAccessRequest,
  resendInvite,
};
