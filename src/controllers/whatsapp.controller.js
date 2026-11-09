const crypto = require('crypto');
const httpStatus = require('http-status');
const catchAsync = require('../utils/catchAsync');
const pick = require('../utils/pick');
const ApiError = require('../utils/ApiError');
const config = require('../config/config');
const logger = require('../config/logger');
const { whatsappService, whatsappAnalyticsService, whatsappBroadcastService, whatsappCallService } = require('../services');
const roleAccess = require('../services/roleAccess.service');
const { whatsapp: waClient } = require('../thirdparty');

// --- Webhook (public — Meta calls these) ---

// GET verification handshake: echo hub.challenge when the verify token matches.
const verifyWebhook = (req, res) => {
  // Meta sends hub.mode / hub.verify_token / hub.challenge as query params, but the
  // dotted keys are removed by express-mongo-sanitize before this runs, so read them
  // straight from the raw URL instead of the sanitized req.query.
  const params = new URLSearchParams(req.originalUrl.split('?')[1] || '');
  const mode = params.get('hub.mode');
  const verifyToken = params.get('hub.verify_token');
  const challenge = params.get('hub.challenge');
  if (mode === 'subscribe' && verifyToken && verifyToken === config.whatsapp.webhookVerifyToken) {
    return res.status(httpStatus.OK).send(challenge);
  }
  return res.sendStatus(httpStatus.FORBIDDEN);
};

// POST inbound events. Verify X-Hub-Signature-256 (when an app secret is set),
// ack Meta immediately, then process asynchronously.
const receiveWebhook = catchAsync(async (req, res) => {
  if (config.whatsapp.appSecret) {
    const signature = req.headers['x-hub-signature-256'] || '';
    const expected = `sha256=${crypto
      .createHmac('sha256', config.whatsapp.appSecret)
      .update(req.rawBody || Buffer.alloc(0))
      .digest('hex')}`;
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expected);
    const ok = sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf);
    if (!ok) return res.sendStatus(httpStatus.FORBIDDEN);
  }
  const io = req.app.get('io');
  res.sendStatus(httpStatus.OK);
  whatsappService
    .processWebhook(io, req.body)
    .catch((e) => logger.error(`[whatsapp] webhook processing error: ${e.message}`));
});

// --- Conversations ---

const getConversations = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['filter', 'search', 'status']);
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await whatsappService.queryConversations(filter, options, req.user);
  res.send(result);
});

const startConversation = catchAsync(async (req, res) => {
  const conv = await whatsappService.startConversation(req.body.phone, req.body.name, req.user);
  res.status(httpStatus.CREATED).send(conv);
});

const getConversation = catchAsync(async (req, res) => {
  res.send(await whatsappService.getConversation(req.params.id));
});

const markRead = catchAsync(async (req, res) => {
  res.send(await whatsappService.markRead(req.params.id));
});

const assign = catchAsync(async (req, res) => {
  const io = req.app.get('io');
  res.send(await whatsappService.assignConversation(io, req.params.id, req.body.assignees, req.user));
});

// --- Messages ---

const listMessages = catchAsync(async (req, res) => {
  const opts = pick(req.query, ['before', 'limit']);
  res.send(await whatsappService.listMessages(req.params.id, opts));
});

const sendText = catchAsync(async (req, res) => {
  try {
    const io = req.app.get('io');
    const msg = await whatsappService.sendText(io, req.params.id, req.body.text, req.body.clientRef, req.user);
    res.status(httpStatus.CREATED).send(msg);
  } catch (e) {
    if (e && e.code === 'WINDOW_CLOSED') return res.status(httpStatus.CONFLICT).send({ code: 'WINDOW_CLOSED' });
    throw e;
  }
});

const sendTemplate = catchAsync(async (req, res) => {
  const io = req.app.get('io');
  const msg = await whatsappService.sendTemplate(io, req.params.id, req.body, req.user);
  res.status(httpStatus.CREATED).send(msg);
});

const sendMedia = catchAsync(async (req, res) => {
  try {
    const io = req.app.get('io');
    const msg = await whatsappService.sendMedia(io, req.params.id, req.body, req.user);
    res.status(httpStatus.CREATED).send(msg);
  } catch (e) {
    if (e && e.code === 'WINDOW_CLOSED') return res.status(httpStatus.CONFLICT).send({ code: 'WINDOW_CLOSED' });
    throw e;
  }
});

const uploadMedia = catchAsync(async (req, res) => {
  if (!req.file) throw new ApiError(httpStatus.BAD_REQUEST, 'No file uploaded');
  res.status(httpStatus.CREATED).send(await whatsappService.uploadMedia(req.file));
});

// --- Internal notes, voice notes, conversation meta ---

const addNote = catchAsync(async (req, res) => {
  const io = req.app.get('io');
  res
    .status(httpStatus.CREATED)
    .send(await whatsappService.addNote(io, req.params.id, req.body.text, req.body.mentions, req.user, req.body.clientRef));
});

const sendVoice = catchAsync(async (req, res) => {
  try {
    const io = req.app.get('io');
    const msg = await whatsappService.sendVoice(
      io,
      req.params.id,
      req.file,
      req.body.clientRef,
      req.body.durationSec,
      req.user
    );
    res.status(httpStatus.CREATED).send(msg);
  } catch (e) {
    if (e && e.code === 'WINDOW_CLOSED') return res.status(httpStatus.CONFLICT).send({ code: 'WINDOW_CLOSED' });
    throw e;
  }
});

const saveMessageAsDocument = catchAsync(async (req, res) => {
  res.status(httpStatus.CREATED).send(await whatsappService.saveMessageAsDocument(req.params.messageId, req.body, req.user));
});

const updateMeta = catchAsync(async (req, res) => {
  res.send(await whatsappService.updateConversationMeta(req.params.id, req.body));
});

// --- Templates ---

const getTemplates = catchAsync(async (req, res) => {
  res.send(await whatsappService.listTemplates());
});

// --- Analytics (management dashboards) ---

const getOverviewAnalytics = catchAsync(async (req, res) => {
  res.send(await whatsappAnalyticsService.overview(req.query.range));
});

const getTeamAnalytics = catchAsync(async (req, res) => {
  res.send(await whatsappAnalyticsService.team(req.query.range));
});

// --- Integration status (setup diagnostics; booleans only, no secrets) ---

const getIntegration = catchAsync(async (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  res.send(whatsappService.getIntegrationStatus(baseUrl));
});

// Admin-only: register the configured number with the Cloud API / read its status.
const registerPhone = catchAsync(async (req, res) => {
  if (!roleAccess.isAdmin(req.user)) throw new ApiError(httpStatus.FORBIDDEN, 'Admins only');
  const result = await waClient.registerPhoneNumber(req.body.pin);
  const status = await waClient.getPhoneNumberStatus();
  res.send({ registered: Boolean(result && result.success), status });
});

const getPhoneStatus = catchAsync(async (req, res) => {
  if (!roleAccess.isAdmin(req.user)) throw new ApiError(httpStatus.FORBIDDEN, 'Admins only');
  res.send({ status: await waClient.getPhoneNumberStatus() });
});

// --- Broadcasts (Phase 3) ---

const getAudienceSegments = catchAsync(async (req, res) => {
  res.send({ results: await whatsappBroadcastService.listSegments(req.user) });
});

const createBroadcast = catchAsync(async (req, res) => {
  const io = req.app.get('io');
  res.status(httpStatus.CREATED).send(await whatsappBroadcastService.createBroadcast(io, req.body, req.user));
});

const listBroadcasts = catchAsync(async (req, res) => {
  res.send(await whatsappBroadcastService.listBroadcasts(req.user, pick(req.query, ['sortBy', 'limit', 'page'])));
});

const getBroadcast = catchAsync(async (req, res) => {
  res.send(await whatsappBroadcastService.getBroadcast(req.params.id, req.user));
});

// --- Calling (Phase 4) ---

const getCallPermission = catchAsync(async (req, res) => {
  res.send(await whatsappCallService.getPermission(req.params.id));
});

const requestCallPermission = catchAsync(async (req, res) => {
  res.send(await whatsappCallService.requestPermission(req.params.id, req.body && req.body.text));
});

const startCall = catchAsync(async (req, res) => {
  const io = req.app.get('io');
  res.status(httpStatus.CREATED).send(await whatsappCallService.startCall(io, req.params.id, req.body.sdpOffer, req.user));
});

const acceptCall = catchAsync(async (req, res) => {
  const io = req.app.get('io');
  res.send(await whatsappCallService.acceptCall(io, req.params.callId, req.body.sdpAnswer));
});

const rejectCall = catchAsync(async (req, res) => {
  const io = req.app.get('io');
  res.send(await whatsappCallService.rejectCall(io, req.params.callId));
});

const terminateCall = catchAsync(async (req, res) => {
  const io = req.app.get('io');
  res.send(await whatsappCallService.terminateCall(io, req.params.callId));
});

const listCalls = catchAsync(async (req, res) => {
  res.send({ results: await whatsappCallService.listCalls(req.params.id) });
});

const getCallSettings = catchAsync(async (req, res) => {
  if (!roleAccess.isAdmin(req.user)) throw new ApiError(httpStatus.FORBIDDEN, 'Admins only');
  res.send(await whatsappCallService.getSettings());
});

const enableCalling = catchAsync(async (req, res) => {
  if (!roleAccess.isAdmin(req.user)) throw new ApiError(httpStatus.FORBIDDEN, 'Admins only');
  const result = await whatsappCallService.enableCalling();
  res.send({ result, settings: await whatsappCallService.getSettings() });
});

module.exports = {
  getAudienceSegments,
  createBroadcast,
  listBroadcasts,
  getBroadcast,
  getCallPermission,
  requestCallPermission,
  startCall,
  acceptCall,
  rejectCall,
  terminateCall,
  listCalls,
  getCallSettings,
  enableCalling,
  registerPhone,
  getPhoneStatus,
  verifyWebhook,
  receiveWebhook,
  getConversations,
  startConversation,
  getConversation,
  markRead,
  assign,
  listMessages,
  sendText,
  sendTemplate,
  sendMedia,
  addNote,
  sendVoice,
  updateMeta,
  saveMessageAsDocument,
  uploadMedia,
  getTemplates,
  getOverviewAnalytics,
  getTeamAnalytics,
  getIntegration,
};
