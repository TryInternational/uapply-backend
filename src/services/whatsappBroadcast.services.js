const httpStatus = require('http-status');
const ApiError = require('../utils/ApiError');
const logger = require('../config/logger');
const { WhatsappBroadcast, WhatsappMessage, WhatsappConversation, Students } = require('../models');
const { whatsapp: waClient } = require('../thirdparty');
const roleAccess = require('./roleAccess.service');

/**
 * Template broadcasts (Phase 3).
 *
 * Meta forbids business-initiated free-form messages, so a broadcast is always
 * an approved template. The frontend submits ONCE; this module resolves the
 * audience, queues the recipients and sends them from a paced in-process worker
 * (Meta's hard ceiling is 80 msg/s per number; we stay far below it so a large
 * send never trips 130429 rate-limit errors). Each recipient becomes a normal
 * outbound WhatsappMessage tagged with `broadcast`, so the thread shows what
 * was sent and the standard status webhook drives the delivered/read counters.
 *
 * NOTE: the worker is in-process. On a single long-lived instance (pm2) that is
 * fine; on autoscaled App Engine a broadcast interrupted by an instance restart
 * stays in `sending` with queued recipients — `resumeStalled()` picks those up
 * on boot.
 */

const SEND_INTERVAL_MS = 150; // ~6-7 msg/s
const PROGRESS_EVERY = 5; // emit progress every N recipients (and always at the end)
const STATUS_RANK = { queued: 0, sent: 1, delivered: 2, read: 3, failed: 4 };

const normalizePhone = (p) => String(p || '').replace(/[^\d]/g, '');

const toDTO = (b) => ({
  id: b._id.toString(),
  templateName: b.templateName,
  language: b.language,
  status: b.status,
  recipientCount: b.recipientCount,
  counters: {
    queued: b.counters.queued || 0,
    sent: b.counters.sent || 0,
    delivered: b.counters.delivered || 0,
    read: b.counters.read || 0,
    failed: b.counters.failed || 0,
  },
  audienceLabel: b.audienceLabel,
  createdAt: b.createdAt ? new Date(b.createdAt).toISOString() : new Date().toISOString(),
  startedAt: b.startedAt ? new Date(b.startedAt).toISOString() : undefined,
  completedAt: b.completedAt ? new Date(b.completedAt).toISOString() : undefined,
  createdBy: b.createdBy ? b.createdBy.toString() : undefined,
  lastError: b.lastError || undefined,
});

const emitProgress = (io, b) => {
  if (!io) return;
  const payload = { broadcastId: b._id.toString(), status: b.status, counters: toDTO(b).counters };
  // Everyone in the inbox may be watching the Broadcasts tab; the creator always is.
  io.emit('wa:broadcast:progress', payload);
};

// ---------------------------------------------------------------------------
// Audience
// ---------------------------------------------------------------------------

/** Mongo filter for the students a broadcast audience describes (scoped for non-admins). */
const studentFilter = (audience, reqUser) => {
  const f = {};
  const a = audience || {};
  if (Array.isArray(a.studentIds) && a.studentIds.length) f._id = { $in: a.studentIds };
  const flt = a.filter || {};
  if (flt.stage) f.stage = flt.stage;
  if (flt.nationality) f.nationality = flt.nationality;
  if (flt.assignedUserId) f['assignedTo.user'] = flt.assignedUserId;
  // Non-admins can only ever broadcast to their own students.
  if (!roleAccess.isAdmin(reqUser)) f['assignedTo.user'] = reqUser._id;
  return f;
};

const resolveRecipients = async (audience, reqUser) => {
  const students = await Students.find(studentFilter(audience, reqUser))
    .select('firstName lastName phoneNo assignedTo')
    .lean();
  const seen = new Set();
  const recipients = [];
  students.forEach((s) => {
    const phone = normalizePhone(s.phoneNo);
    if (phone.length < 8 || seen.has(phone)) return;
    seen.add(phone);
    recipients.push({
      student: s._id,
      phone,
      name: [s.firstName, s.lastName].filter(Boolean).join(' ').trim() || undefined,
      status: 'queued',
    });
  });
  return recipients;
};

/** Named segments for the composer, with live counts. */
const listSegments = async (reqUser) => {
  const isAdmin = roleAccess.isAdmin(reqUser);
  const base = isAdmin ? {} : { 'assignedTo.user': reqUser._id };
  const count = (extra) => Students.countDocuments({ ...base, ...extra, phoneNo: { $exists: true, $ne: '' } });
  const segments = [];
  segments.push({
    key: 'my-students',
    label: 'My students',
    estimatedRecipients: await Students.countDocuments({
      'assignedTo.user': reqUser._id,
      phoneNo: { $exists: true, $ne: '' },
    }),
    audience: { filter: { assignedUserId: reqUser._id.toString() } },
  });
  if (isAdmin) {
    segments.push({
      key: 'all-students',
      label: 'All students',
      estimatedRecipients: await count({}),
      audience: { filter: {} },
    });
  }
  const stages = ['NotApplied', 'Applied', 'Enrolled', 'Lost'];
  const labels = { NotApplied: 'Not applied', Applied: 'Applied', Enrolled: 'Enrolled', Lost: 'Lost' };
  // eslint-disable-next-line no-restricted-syntax
  for (const st of stages) {
    // eslint-disable-next-line no-await-in-loop
    const n = await count({ stage: st });
    if (n > 0) {
      segments.push({
        key: `stage-${st.toLowerCase()}`,
        label: `Stage · ${labels[st]}`,
        estimatedRecipients: n,
        audience: { filter: { stage: st } },
      });
    }
  }
  return segments;
};

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/* eslint-disable no-param-reassign */
const recount = (b) => {
  const c = { queued: 0, sent: 0, delivered: 0, read: 0, failed: 0 };
  b.recipients.forEach((r) => {
    c[r.status] = (c[r.status] || 0) + 1;
  });
  b.counters = c;
};
/* eslint-enable no-param-reassign */

const findOrCreateConversation = async (recipient) => {
  let conv = await WhatsappConversation.findOne({ 'contact.waId': recipient.phone });
  if (conv) return conv;
  const student = recipient.student ? await Students.findById(recipient.student).select('assignedTo') : null;
  conv = await WhatsappConversation.create({
    contact: { phone: recipient.phone, name: recipient.name, waId: recipient.phone },
    student: recipient.student || undefined,
    assignees: student
      ? (student.assignedTo || []).filter((a) => a.user).map((a) => ({ userId: a.user, role: a.role }))
      : [],
  });
  return conv;
};

const renderBody = (tpl, components) => {
  const body = tpl && tpl.components ? (tpl.components.find((c) => c.type === 'BODY') || {}).text || '' : '';
  const params = ((components || []).find((c) => c.type === 'body') || {}).parameters || [];
  let text = body;
  params.forEach((p, i) => {
    text = text.replace(new RegExp(`\\{\\{${i + 1}\\}\\}`, 'g'), p.text || '');
  });
  return text;
};

const runBroadcast = async (io, broadcastId) => {
  const b = await WhatsappBroadcast.findById(broadcastId);
  if (!b || b.status === 'completed') return;
  b.status = 'sending';
  b.startedAt = b.startedAt || new Date();
  await b.save();
  emitProgress(io, b);

  let tpl;
  try {
    const templates = await waClient.listTemplates();
    tpl = (templates || []).find((t) => t.name === b.templateName);
  } catch (e) {
    tpl = undefined;
  }
  const text = renderBody(tpl, b.defaultComponents);

  let sinceProgress = 0;
  // eslint-disable-next-line no-restricted-syntax
  for (const r of b.recipients) {
    if (r.status !== 'queued') continue; // eslint-disable-line no-continue
    try {
      // eslint-disable-next-line no-await-in-loop
      const conv = await findOrCreateConversation(r);
      // eslint-disable-next-line no-await-in-loop
      const resp = await waClient.sendTemplate(r.phone, b.templateName, b.language, b.defaultComponents);
      const waMessageId = resp && resp.messages && resp.messages[0] && resp.messages[0].id;
      // eslint-disable-next-line no-await-in-loop
      const msg = await WhatsappMessage.create({
        conversation: conv._id,
        waMessageId,
        broadcast: b._id,
        direction: 'outbound',
        type: 'template',
        text,
        template: { name: b.templateName, language: b.language },
        status: 'sent',
        timestamp: new Date(),
        sentByUser: b.createdBy,
      });
      conv.lastMessage = { preview: text || 'Template message', at: msg.timestamp, direction: 'outbound' };
      conv.lastMessageAt = msg.timestamp;
      // eslint-disable-next-line no-await-in-loop
      await conv.save();
      r.conversation = conv._id;
      r.message = msg._id;
      r.status = 'sent';
    } catch (e) {
      r.status = 'failed';
      r.error = { code: e.code ? String(e.code) : 'SEND_FAILED', title: e.message };
      b.lastError = e.message;
    }
    sinceProgress += 1;
    if (sinceProgress >= PROGRESS_EVERY) {
      recount(b);
      b.markModified('recipients');
      // eslint-disable-next-line no-await-in-loop
      await b.save();
      emitProgress(io, b);
      sinceProgress = 0;
    }
    // eslint-disable-next-line no-await-in-loop
    await sleep(SEND_INTERVAL_MS);
  }

  recount(b);
  b.status = b.recipients.length && b.counters.failed === b.recipients.length ? 'failed' : 'completed';
  b.completedAt = new Date();
  b.markModified('recipients');
  await b.save();
  emitProgress(io, b);
};

const kick = (io, id) => {
  setImmediate(() => {
    runBroadcast(io, id).catch((e) => logger.error(`[whatsapp] broadcast ${id} failed: ${e.message}`));
  });
};

/** Pick up broadcasts left in `sending`/`queued` by a restart. Call once on boot. */
const resumeStalled = async (io) => {
  const stalled = await WhatsappBroadcast.find({ status: { $in: ['queued', 'sending'] } }).select('_id');
  stalled.forEach((b) => kick(io, b._id));
  return stalled.length;
};

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

const createBroadcast = async (io, payload, reqUser) => {
  const recipients = await resolveRecipients(payload.audience, reqUser);
  if (!recipients.length) throw new ApiError(httpStatus.BAD_REQUEST, 'No students with a phone number match this audience');
  const b = await WhatsappBroadcast.create({
    templateName: payload.templateName,
    language: payload.language,
    defaultComponents: payload.defaultComponents || [],
    audience: payload.audience || {},
    audienceLabel: payload.audienceLabel,
    recipientCount: recipients.length,
    recipients,
    counters: { queued: recipients.length, sent: 0, delivered: 0, read: 0, failed: 0 },
    createdBy: reqUser._id,
  });
  kick(io, b._id);
  return toDTO(b);
};

const listBroadcasts = async (reqUser, options = {}) => {
  const filter = roleAccess.isAdmin(reqUser) ? {} : { createdBy: reqUser._id };
  const result = await WhatsappBroadcast.paginate(filter, {
    ...options,
    sortBy: options.sortBy || 'createdAt:desc',
    limit: options.limit || 20,
  });
  return { ...result, results: result.results.map(toDTO) };
};

const getBroadcast = async (id, reqUser) => {
  const b = await WhatsappBroadcast.findById(id);
  if (!b) throw new ApiError(httpStatus.NOT_FOUND, 'Broadcast not found');
  if (!roleAccess.isAdmin(reqUser) && String(b.createdBy) !== String(reqUser._id)) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Not your broadcast');
  }
  return {
    ...toDTO(b),
    recipients: b.recipients.map((r) => ({
      studentId: r.student ? r.student.toString() : undefined,
      phone: r.phone,
      name: r.name,
      conversationId: r.conversation ? r.conversation.toString() : undefined,
      status: r.status,
      error: r.error && r.error.code ? { code: r.error.code, title: r.error.title } : undefined,
    })),
  };
};

/**
 * Called from the status webhook when a message that belongs to a broadcast
 * moves (delivered / read / failed). Keeps the per-recipient status monotonic
 * and re-derives the counters.
 */
const onMessageStatus = async (io, msg) => {
  if (!msg.broadcast) return;
  const b = await WhatsappBroadcast.findById(msg.broadcast);
  if (!b) return;
  const r = b.recipients.find((x) => x.message && String(x.message) === String(msg._id));
  if (!r) return;
  const next = STATUS_RANK[msg.status];
  const cur = STATUS_RANK[r.status];
  if (msg.status !== 'failed' && next <= cur) return;
  r.status = msg.status;
  if (msg.error && msg.error.code) r.error = { code: msg.error.code, title: msg.error.title };
  recount(b);
  b.markModified('recipients');
  await b.save();
  emitProgress(io, b);
};

module.exports = {
  listSegments,
  createBroadcast,
  listBroadcasts,
  getBroadcast,
  onMessageStatus,
  resumeStalled,
  // exported for tests
  resolveRecipients,
  studentFilter,
};
