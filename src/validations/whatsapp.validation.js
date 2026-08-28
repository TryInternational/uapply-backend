const Joi = require('joi');
const { objectId } = require('./custom.validation');

const getConversations = {
  query: Joi.object().keys({
    filter: Joi.string().valid('mine', 'unassigned', 'all'),
    assignedUserId: Joi.string(),
    assignedUserRoleId: Joi.string(),
    search: Joi.string().allow(''),
    status: Joi.string().valid('open', 'closed'),
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

const conversationId = {
  params: Joi.object().keys({ id: Joi.string().custom(objectId) }),
};

const analytics = {
  query: Joi.object().keys({ range: Joi.string().valid('today', '7d', '30d') }),
};

const listMessages = {
  params: Joi.object().keys({ id: Joi.string().custom(objectId) }),
  query: Joi.object().keys({
    before: Joi.string(),
    limit: Joi.number().integer(),
  }),
};

const sendText = {
  params: Joi.object().keys({ id: Joi.string().custom(objectId) }),
  body: Joi.object().keys({
    text: Joi.string().required(),
    clientRef: Joi.string(),
  }),
};

const sendTemplate = {
  params: Joi.object().keys({ id: Joi.string().custom(objectId) }),
  body: Joi.object().keys({
    templateName: Joi.string().required(),
    language: Joi.string().required(),
    components: Joi.array().items(Joi.object()).default([]),
    clientRef: Joi.string(),
  }),
};

const sendMedia = {
  params: Joi.object().keys({ id: Joi.string().custom(objectId) }),
  body: Joi.object().keys({
    mediaId: Joi.string().required(),
    type: Joi.string().valid('image', 'document', 'audio').required(),
    caption: Joi.string().allow(''),
    filename: Joi.string(),
    clientRef: Joi.string(),
  }),
};

const assign = {
  params: Joi.object().keys({ id: Joi.string().custom(objectId) }),
  body: Joi.object().keys({
    assignees: Joi.array()
      .items(
        Joi.object().keys({
          userId: Joi.string().custom(objectId).required(),
          role: Joi.string().required(),
        })
      )
      .required(),
  }),
};

const addNote = {
  params: Joi.object().keys({ id: Joi.string().custom(objectId) }),
  body: Joi.object().keys({
    text: Joi.string().required(),
    mentions: Joi.array().items(Joi.string().custom(objectId)),
  }),
};

const updateMeta = {
  params: Joi.object().keys({ id: Joi.string().custom(objectId) }),
  body: Joi.object().keys({
    status: Joi.string().valid('open', 'waiting', 'resolved'),
    priority: Joi.string().valid('low', 'medium', 'high'),
    tags: Joi.array().items(Joi.string()),
    nextFollowUpAt: Joi.string().allow(null),
  }),
};

module.exports = {
  getConversations,
  conversationId,
  analytics,
  listMessages,
  sendText,
  sendTemplate,
  sendMedia,
  assign,
  addNote,
  updateMeta,
};
