const crypto = require('crypto');
const httpStatus = require('http-status');
const catchAsync = require('../utils/catchAsync');
const pick = require('../utils/pick');
const ApiError = require('../utils/ApiError');
const config = require('../config/config');
const logger = require('../config/logger');
const { whatsappService, whatsappAnalyticsService } = require('../services');

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
    .send(await whatsappService.addNote(io, req.params.id, req.body.text, req.body.mentions, req.user));
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

module.exports = {
  verifyWebhook,
  receiveWebhook,
  getConversations,
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
  uploadMedia,
  getTemplates,
  getOverviewAnalytics,
  getTeamAnalytics,
  getIntegration,
};
