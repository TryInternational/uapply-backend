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

const registerPhone = {
  body: Joi.object().keys({
    pin: Joi.string()
      .pattern(/^\d{6}$/)
      .required(),
  }),
};

const startConversation = {
  body: Joi.object().keys({
    phone: Joi.string().trim().min(8).max(20).required(),
    name: Joi.string().trim().max(80).allow(''),
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
    clientRef: Joi.string(),
  }),
};

const saveMessageAsDocument = {
  params: Joi.object().keys({ messageId: Joi.string().custom(objectId).required() }),
  body: Joi.object().keys({
    docTypeKey: Joi.string().max(40).required(),
    label: Joi.string().max(80),
    applicationId: Joi.string().custom(objectId),
  }),
};

const updateMeta = {
  params: Joi.object().keys({ id: Joi.string().custom(objectId) }),
  body: Joi.object().keys({
    status: Joi.string().valid('open', 'waiting', 'resolved'),
    priority: Joi.string().valid('low', 'medium', 'high'),
    tags: Joi.array().items(Joi.string()),
    nextFollowUpAt: Joi.string().allow(null),
    contactName: Joi.string().max(100).allow('', null),
    studentId: Joi.string().custom(objectId),
  }),
};

const createBroadcast = {
  body: Joi.object().keys({
    templateName: Joi.string().required(),
    language: Joi.string().required(),
    audience: Joi.object()
      .keys({
        studentIds: Joi.array().items(Joi.string().custom(objectId)),
        filter: Joi.object().keys({
          assignedUserId: Joi.string().custom(objectId),
          stage: Joi.string(),
          nationality: Joi.string(),
        }),
      })
      .required(),
    defaultComponents: Joi.array().items(Joi.object()).default([]),
    audienceLabel: Joi.string().max(80),
  }),
};

const broadcastId = { params: Joi.object().keys({ id: Joi.string().custom(objectId).required() }) };

const requestCallPermission = {
  params: Joi.object().keys({ id: Joi.string().custom(objectId).required() }),
  body: Joi.object().keys({ text: Joi.string().max(1024) }),
};

const startCall = {
  params: Joi.object().keys({ id: Joi.string().custom(objectId).required() }),
  body: Joi.object().keys({ sdpOffer: Joi.string().max(65536).required() }),
};

const acceptCall = {
  params: Joi.object().keys({ callId: Joi.string().custom(objectId).required() }),
  body: Joi.object().keys({ sdpAnswer: Joi.string().max(65536).required() }),
};

const callId = { params: Joi.object().keys({ callId: Joi.string().custom(objectId).required() }) };

module.exports = {
  createBroadcast,
  broadcastId,
  requestCallPermission,
  startCall,
  acceptCall,
  callId,
  getConversations,
  conversationId,
  analytics,
  listMessages,
  sendText,
  sendTemplate,
  sendMedia,
  registerPhone,
  startConversation,
  assign,
  addNote,
  updateMeta,
  saveMessageAsDocument,
};
