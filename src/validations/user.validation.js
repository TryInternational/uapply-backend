const Joi = require('joi');
const { password, objectId } = require('./custom.validation');

const createUser = {
  body: Joi.object().keys({
    email: Joi.string().required().email(),
    password: Joi.string().required().custom(password),
    name: Joi.string().required(),
    slackMemberId: Joi.string(),
    avatar: Joi.string(),
    role: Joi.required().custom(objectId),
  }),
};

const getUsers = {
  query: Joi.object().keys({
    name: Joi.string(),
    role: Joi.string(),
    avatar: Joi.string(),
    slackMemberId: Joi.string(),
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

const getUser = {
  params: Joi.object().keys({
    userId: Joi.string().custom(objectId),
  }),
};

const updateUser = {
  params: Joi.object().keys({
    userId: Joi.required().custom(objectId),
  }),
  body: Joi.object()
    .keys({
      email: Joi.string().email(),
      // '' removes the photo (the portals' "Remove" button sends it)
      avatar: Joi.string().allow(''),
      slackMemberId: Joi.string(),
      password: Joi.string().custom(password),
      name: Joi.string(),
      // Settings › Users "Change role" — admins only, never your own (user.controller)
      role: Joi.string().custom(objectId),
      // partner portal "Rate your experience"
      rating: Joi.number().integer().min(0).max(5),
      feedback: Joi.string().allow('').max(2000),
      // Settings › Users "Close account" / "Reopen" — admins only (user.controller)
      former: Joi.boolean(),
      // a partner's own company logo (My account); '' removes it. Staff set it
      // from the partner directory through /partners/:id/logo instead.
      organisationLogo: Joi.string()
        .uri({ scheme: ['https'] })
        .allow(''),
    })
    .min(1),
};

const deleteUser = {
  params: Joi.object().keys({
    userId: Joi.string().custom(objectId),
  }),
};

module.exports = {
  createUser,
  getUsers,
  getUser,
  updateUser,
  deleteUser,
};
