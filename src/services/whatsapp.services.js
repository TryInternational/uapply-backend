const httpStatus = require('http-status');
const ApiError = require('../utils/ApiError');
const config = require('../config/config');
const { WhatsappConversation, WhatsappMessage, Students } = require('../models');
const { whatsapp: waClient } = require('../thirdparty');
const firebase = require('../thirdparty/firebase');
const notificationsService = require('./notifications.services');
// Which roles are admin comes from the roles collection, not from ids pasted
// here. Admins may view the Unassigned / All inboxes; everyone else is scoped
// to their own chats.
const roleAccess = require('./roleAccess.service');

// Best-effort display name for a conversation (contact name → student → phone).
const displayName = (conv) => {
  const c = conv.contact || {};
  const s = conv.student || {};
  const sName = [s.firstName, s.lastName].filter(Boolean).join(' ').trim();
  return c.name || sName || c.phone || 'a contact';
};

const WINDOW_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const normalizePhone = (p) => String(p || '').replace(/[^\d]/g, '');
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const windowStatusOf = (expiresAt) => (expiresAt && new Date(expiresAt).getTime() > Date.now() ? 'open' : 'closed');
const isoOrNull = (d) => (d ? new Date(d).toISOString() : null);

const mimeExt = (mime = '') => {
  const map = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'application/pdf': '.pdf',
    'audio/ogg': '.ogg',
    'audio/mpeg': '.mp3',
  };
  return map[mime] || '';
};

const mediaTypeFromMime = (mime = '') => {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  return 'document';
};

const templateExample = (c) => {
  if (c.example && c.example.body_text) return c.example.body_text[0];
  if (Array.isArray(c.example)) return c.example;
  return undefined;
};

const previewOf = (msg) => {
  if (msg.text) return msg.text;
  if (msg.type === 'image') return '📷 Photo';
  if (msg.type === 'audio') return '🎤 Audio';
  if (msg.type === 'document') return '📄 Document';
  if (msg.type === 'template') return 'Template message';
  return 'Message';
};

/** Tolerant student lookup: stored phoneNo may carry '+'/spaces, so match the tail digits. */
const findStudentByPhone = async (phone) => {
  const norm = normalizePhone(phone);
  if (norm.length < 6) return null;
  const tail = norm.slice(-9);
  return Students.findOne({ phoneNo: { $regex: `${escapeRegex(tail)}$` } }).select(
    'firstName lastName stage assignedTo phoneNo'
  );
};

const recipientUserIds = (conv) => {
  const ids = new Set();
  (conv.assignees || []).forEach((a) => {
    if (a && a.userId) ids.add(a.userId.toString());
  });
  return [...ids];
};

const emitToUsers = (io, userIds, event, payload) => {
  if (!io) return;
  [...new Set(userIds)].forEach((uid) => io.to(uid.toString()).emit(event, payload));
};


// ---------------------------------------------------------------------------
// DTO builders — shape docs to the exact frontend contract (src/types/whatsapp.ts)
// ---------------------------------------------------------------------------

const toMessageDTO = (m) => ({
  id: m._id.toString(),
  clientRef: m.clientRef || undefined,
  conversationId: m.conversation ? m.conversation.toString() : m.conversation,
  direction: m.direction,
  type: m.type,
  text: m.text || undefined,
  media:
    m.media && m.media.mediaId
      ? {
          mediaId: m.media.mediaId,
          url: m.media.url,
          mimeType: m.media.mimeType,
          type: m.media.type,
          filename: m.media.filename,
          size: m.media.size,
        }
      : undefined,
  template: m.template && m.template.name ? { name: m.template.name, language: m.template.language } : undefined,
  status: m.status,
  error: m.error && m.error.code ? { code: m.error.code, title: m.error.title } : undefined,
  timestamp: m.timestamp ? new Date(m.timestamp).toISOString() : new Date().toISOString(),
  sentByUserId: m.sentByUser ? m.sentByUser.toString() : undefined,
  internal: m.internal || undefined,
  durationSec: m.durationSec,
  mentions: m.mentions && m.mentions.length ? m.mentions.map((x) => x.toString()) : undefined,
});

// Loose label from a free-form value (nationality/residence are stored as objects).
const labelOf = (v) => {
  if (!v) return undefined;
  if (typeof v === 'string') return v;
  return v.label || v.name || v.value || undefined;
};

const toConversationDTO = (conv) => {
  const s = conv.student;
  const student =
    s && s._id
      ? {
          id: s._id.toString(),
          name: [s.firstName, s.lastName].filter(Boolean).join(' ').trim() || undefined,
          stage: s.stage,
          assignedTo: (s.assignedTo || []).map((a) => ({ user: a.user ? a.user.toString() : a.user, role: a.role })),
          // Rich profile mapped from fields that exist on the Student model
          country: labelOf(s.nationality) || labelOf(s.residence),
          ielts: s.testScore || undefined,
          leadSource: s.ambassadorName || s.source || undefined,
          parentPhone: s.emergencyContact && s.emergencyContact[0] ? s.emergencyContact[0].emergencyContactNo : undefined,
          notes: s.importantComment || undefined,
        }
      : undefined;
  return {
    id: conv._id.toString(),
    contact: { phone: conv.contact.phone, name: conv.contact.name, waId: conv.contact.waId },
    student,
    lastMessage:
      conv.lastMessage && conv.lastMessage.at
        ? {
            preview: conv.lastMessage.preview,
            at: new Date(conv.lastMessage.at).toISOString(),
            direction: conv.lastMessage.direction,
          }
        : undefined,
    lastMessageAt: conv.lastMessageAt ? new Date(conv.lastMessageAt).toISOString() : new Date(0).toISOString(),
    unreadCount: conv.unreadCount || 0,
    windowStatus: windowStatusOf(conv.windowExpiresAt),
    windowExpiresAt: isoOrNull(conv.windowExpiresAt),
    assignees: (conv.assignees || []).map((a) => ({ userId: a.userId ? a.userId.toString() : a.userId, role: a.role })),
    status: conv.status || 'open',
    priority: conv.priority || 'medium',
    tags: conv.tags || [],
    nextFollowUpAt: isoOrNull(conv.nextFollowUpAt),
  };
};

const renderTemplateBody = (tpl, components) => {
  const body = tpl && tpl.components ? (tpl.components.find((c) => c.type === 'BODY') || {}).text || '' : '';
  const params = ((components || []).find((c) => c.type === 'body') || {}).parameters || [];
  let text = body;
  params.forEach((p, i) => {
    text = text.replace(new RegExp(`\\{\\{${i + 1}\\}\\}`, 'g'), p.text || '');
  });
  return text;
};

const mapTemplate = (t) => ({
  name: t.name,
  language: typeof t.language === 'string' ? t.language : (t.language && t.language.code) || 'en',
  category: t.category,
  status: t.status,
  components: (t.components || []).map((c) => ({
    type: c.type,
    format: c.format,
    text: c.text,
    example: templateExample(c),
    buttons: c.buttons,
  })),
});

// ---------------------------------------------------------------------------
// Inbound webhook processing
// ---------------------------------------------------------------------------

const storeInboundMedia = async (metaMedia, type) => {
  try {
    const url = await waClient.getMediaUrl(metaMedia.id);
    const buffer = await waClient.downloadMedia(url);
    let publicUrl;
    if (buffer && buffer.length) {
      publicUrl = await firebase.uploadBuffer(
        buffer,
        `whatsapp/in/${metaMedia.id}${mimeExt(metaMedia.mime_type)}`,
        metaMedia.mime_type
      );
    }
    return {
      mediaId: metaMedia.id,
      url: publicUrl,
      mimeType: metaMedia.mime_type,
      type,
      filename: metaMedia.filename,
      size: buffer ? buffer.length : undefined,
    };
  } catch (e) {
    return { mediaId: metaMedia.id, url: undefined, mimeType: metaMedia.mime_type, type, filename: metaMedia.filename };
  }
};

const upsertConversationByPhone = async (from, profileName) => {
  let conv = await WhatsappConversation.findOne({ 'contact.waId': from });
  if (conv) {
    if (profileName && !conv.contact.name) {
      conv.contact.name = profileName;
      await conv.save();
    }
    return conv;
  }
  const student = await findStudentByPhone(from);
  conv = await WhatsappConversation.create({
    contact: { phone: from, name: profileName, waId: from },
    student: student ? student._id : undefined,
    assignees: student
      ? (student.assignedTo || []).filter((a) => a.user).map((a) => ({ userId: a.user, role: a.role }))
      : [],
  });
  return conv;
};

const handleInboundMessages = async (io, value) => {
  const profileName =
    value.contacts && value.contacts[0] && value.contacts[0].profile ? value.contacts[0].profile.name : undefined;
  await Promise.all(
    (value.messages || []).map(async (message) => {
      const { from } = message;
      const conv = await upsertConversationByPhone(from, profileName);

      let { type } = message;
      let text;
      let media;
      if (type === 'text') {
        text = message.text && message.text.body;
      } else if (['image', 'document', 'audio'].includes(type)) {
        const m = message[type] || {};
        text = m.caption;
        media = await storeInboundMedia(m, type);
      } else {
        // interactive/button/reaction/etc — persist a best-effort system line
        type = 'system';
        text = `[${message.type}]`;
      }

      const msg = await WhatsappMessage.create({
        conversation: conv._id,
        waMessageId: message.id,
        direction: 'inbound',
        type,
        text,
        media,
        status: 'delivered',
        timestamp: message.timestamp ? new Date(Number(message.timestamp) * 1000) : new Date(),
      });

      conv.unreadCount = (conv.unreadCount || 0) + 1;
      conv.lastMessage = { preview: previewOf(msg), at: msg.timestamp, direction: 'inbound' };
      conv.lastMessageAt = msg.timestamp;
      conv.windowExpiresAt = new Date(Date.now() + WINDOW_MS);
      await conv.save();
      await conv.populate(
        'student',
        'firstName lastName stage assignedTo nationality residence testScore ambassadorName source emergencyContact importantComment'
      );

      const recipients = recipientUserIds(conv);
      emitToUsers(io, recipients, 'wa:message:new', { ...toMessageDTO(msg), conversation: toConversationDTO(conv) });
      emitToUsers(io, recipients, 'wa:conversation:window', {
        conversationId: conv._id.toString(),
        status: 'open',
        windowExpiresAt: conv.windowExpiresAt.toISOString(),
      });
      // Notify the assigned counselor(s) of a new message from their student.
      notificationsService.createWhatsappNotification(
        io,
        recipients,
        `New WhatsApp message from ${displayName(conv)}: ${previewOf(msg)}`.slice(0, 180),
        { studentId: conv.student ? conv.student._id : undefined, conversationId: conv._id }
      );
    })
  );
};

const handleStatusUpdates = async (io, value) => {
  await Promise.all(
    (value.statuses || []).map(async (st) => {
      const msg = await WhatsappMessage.findOne({ waMessageId: st.id });
      if (!msg) return;
      msg.status = st.status; // Meta emits sent | delivered | read | failed
      if (st.errors && st.errors[0]) msg.error = { code: String(st.errors[0].code), title: st.errors[0].title };
      await msg.save();

      const conv = await WhatsappConversation.findById(msg.conversation).populate('student', 'assignedTo');
      const recipients = conv ? recipientUserIds(conv) : [];
      emitToUsers(io, recipients, 'wa:message:status', {
        conversationId: msg.conversation.toString(),
        messageId: msg._id.toString(),
        clientRef: msg.clientRef || undefined,
        status: msg.status,
        timestamp: new Date().toISOString(),
        error: msg.error && msg.error.code ? { code: msg.error.code, title: msg.error.title } : undefined,
      });
    })
  );
};

const processWebhook = async (io, body) => {
  const changes = (body.entry || []).flatMap((e) => e.changes || []);
  await Promise.all(
    changes.map(async (change) => {
      const value = (change && change.value) || {};
      if (value.messages && value.messages.length) await handleInboundMessages(io, value);
      if (value.statuses && value.statuses.length) await handleStatusUpdates(io, value);
    })
  );
};

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

const queryConversations = async (filter, options, reqUser) => {
  const isAdmin = roleAccess.isAdmin(reqUser);
  const view = filter.filter || 'mine';
  const mongoFilter = {};
  if (view === 'unassigned' && isAdmin) mongoFilter.assignees = { $size: 0 };
  else if (view === 'all' && isAdmin) {
    /* no ownership constraint */
  } else {
    // 'mine', or a non-admin asking for unassigned/all → scope to own chats
    mongoFilter['assignees.userId'] = reqUser._id;
  }
  if (filter.search) {
    const rx = new RegExp(escapeRegex(filter.search), 'i');
    mongoFilter.$or = [{ 'contact.name': rx }, { 'contact.phone': rx }];
  }
  const result = await WhatsappConversation.paginate(mongoFilter, {
    ...options,
    sortBy: options.sortBy || 'lastMessageAt:desc',
  });
  await WhatsappConversation.populate(result.results, {
    path: 'student',
    select:
      'firstName lastName stage assignedTo nationality residence testScore ambassadorName source emergencyContact importantComment',
  });
  return { ...result, results: result.results.map(toConversationDTO) };
};

const getConversation = async (id) => {
  const conv = await WhatsappConversation.findById(id).populate(
    'student',
    'firstName lastName stage assignedTo nationality residence testScore ambassadorName source emergencyContact importantComment'
  );
  if (!conv) throw new ApiError(httpStatus.NOT_FOUND, 'Conversation not found');
  return toConversationDTO(conv);
};

const listMessages = async (conversationId, opts = {}) => {
  const limit = Math.min(parseInt(opts.limit, 10) || 30, 100);
  const query = { conversation: conversationId };
  if (opts.before) query.timestamp = { $lt: new Date(opts.before) };
  const docs = await WhatsappMessage.find(query)
    .sort({ timestamp: -1 })
    .limit(limit + 1);
  const hasMore = docs.length > limit;
  const page = docs.slice(0, limit).reverse(); // ascending for the thread
  const nextCursor = hasMore && page.length ? new Date(page[0].timestamp).toISOString() : undefined;
  return { messages: page.map(toMessageDTO), nextCursor };
};

const markRead = async (conversationId) => {
  const conv = await WhatsappConversation.findById(conversationId);
  if (!conv) throw new ApiError(httpStatus.NOT_FOUND, 'Conversation not found');
  conv.unreadCount = 0;
  await conv.save();
  const lastInbound = await WhatsappMessage.findOne({ conversation: conversationId, direction: 'inbound' }).sort({
    timestamp: -1,
  });
  if (lastInbound && lastInbound.waMessageId) waClient.markRead(lastInbound.waMessageId).catch(() => {});
  return { unreadCount: 0 };
};

const assignConversation = async (io, conversationId, assignees, actingUser) => {
  const conv = await WhatsappConversation.findById(conversationId).populate('student');
  if (!conv) throw new ApiError(httpStatus.NOT_FOUND, 'Conversation not found');
  const prevIds = new Set((conv.assignees || []).map((a) => a.userId && a.userId.toString()));
  conv.assignees = (assignees || []).map((a) => ({ userId: a.userId, role: a.role }));
  await conv.save();
  if (conv.student) {
    const student = await Students.findById(conv.student._id || conv.student);
    if (student) {
      student.assignedTo = (assignees || []).map((a) => ({ user: a.userId, role: a.role }));
      await student.save();
    }
  }
  await conv.populate(
    'student',
    'firstName lastName stage assignedTo nationality residence testScore ambassadorName source emergencyContact importantComment'
  );
  const dto = toConversationDTO(conv);
  emitToUsers(io, recipientUserIds(conv), 'wa:conversation:assigned', {
    conversationId,
    assignees: dto.assignees,
    student: dto.student,
  });
  // Notify the newly-assigned counselor(s) (skip anyone already assigned).
  const newlyAssigned = (assignees || []).map((a) => a.userId).filter((id) => id && !prevIds.has(id.toString()));
  notificationsService.createWhatsappNotification(
    io,
    newlyAssigned,
    `You were assigned to ${displayName(conv)}'s WhatsApp chat`,
    {
      studentId: conv.student ? conv.student._id : undefined,
      conversationId: conv._id,
      createdBy: actingUser ? actingUser._id : undefined,
    }
  );
  return dto;
};

// ---------------------------------------------------------------------------
// Outbound
// ---------------------------------------------------------------------------

const windowClosedError = () => {
  const err = new ApiError(httpStatus.CONFLICT, 'WINDOW_CLOSED');
  err.code = 'WINDOW_CLOSED';
  return err;
};

const sendText = async (io, conversationId, text, clientRef, user) => {
  const conv = await WhatsappConversation.findById(conversationId);
  if (!conv) throw new ApiError(httpStatus.NOT_FOUND, 'Conversation not found');
  if (windowStatusOf(conv.windowExpiresAt) === 'closed') throw windowClosedError();
  const resp = await waClient.sendText(conv.contact.phone, text);
  const waMessageId = resp && resp.messages && resp.messages[0] && resp.messages[0].id;
  const msg = await WhatsappMessage.create({
    conversation: conversationId,
    waMessageId,
    clientRef,
    direction: 'outbound',
    type: 'text',
    text,
    status: 'sent',
    timestamp: new Date(),
    sentByUser: user._id,
  });
  conv.lastMessage = { preview: previewOf(msg), at: msg.timestamp, direction: 'outbound' };
  conv.lastMessageAt = msg.timestamp;
  await conv.save();
  return toMessageDTO(msg);
};

const sendTemplate = async (io, conversationId, payload, user) => {
  const conv = await WhatsappConversation.findById(conversationId);
  if (!conv) throw new ApiError(httpStatus.NOT_FOUND, 'Conversation not found');
  const templates = await waClient.listTemplates();
  const tpl = (templates || []).find((t) => t.name === payload.templateName);
  const text = renderTemplateBody(tpl, payload.components);
  const resp = await waClient.sendTemplate(conv.contact.phone, payload.templateName, payload.language, payload.components);
  const waMessageId = resp && resp.messages && resp.messages[0] && resp.messages[0].id;
  const msg = await WhatsappMessage.create({
    conversation: conversationId,
    waMessageId,
    clientRef: payload.clientRef,
    direction: 'outbound',
    type: 'template',
    text,
    template: { name: payload.templateName, language: payload.language },
    status: 'sent',
    timestamp: new Date(),
    sentByUser: user._id,
  });
  conv.lastMessage = { preview: previewOf(msg), at: msg.timestamp, direction: 'outbound' };
  conv.lastMessageAt = msg.timestamp;
  await conv.save();
  return toMessageDTO(msg);
};

const sendMedia = async (io, conversationId, payload, user) => {
  const conv = await WhatsappConversation.findById(conversationId);
  if (!conv) throw new ApiError(httpStatus.NOT_FOUND, 'Conversation not found');
  if (windowStatusOf(conv.windowExpiresAt) === 'closed') throw windowClosedError();
  const link = /^https?:\/\//.test(payload.mediaId) ? payload.mediaId : undefined;
  const resp = await waClient.sendMedia(conv.contact.phone, {
    type: payload.type,
    link,
    id: link ? undefined : payload.mediaId,
    caption: payload.caption,
    filename: payload.filename,
  });
  const waMessageId = resp && resp.messages && resp.messages[0] && resp.messages[0].id;
  const msg = await WhatsappMessage.create({
    conversation: conversationId,
    waMessageId,
    clientRef: payload.clientRef,
    direction: 'outbound',
    type: payload.type,
    text: payload.caption,
    media: { mediaId: payload.mediaId, url: link, type: payload.type, filename: payload.filename },
    status: 'sent',
    timestamp: new Date(),
    sentByUser: user._id,
  });
  conv.lastMessage = { preview: previewOf(msg), at: msg.timestamp, direction: 'outbound' };
  conv.lastMessageAt = msg.timestamp;
  await conv.save();
  return toMessageDTO(msg);
};

/** Post an internal note — staff-only, never sent to WhatsApp. `mentions` are
 *  the userIds of teammates @tagged in the note (they get notified). */
const addNote = async (io, conversationId, text, mentions, user) => {
  const conv = await WhatsappConversation.findById(conversationId).populate('student', 'firstName lastName assignedTo');
  if (!conv) throw new ApiError(httpStatus.NOT_FOUND, 'Conversation not found');
  const mentionIds = Array.isArray(mentions) ? [...new Set(mentions.filter(Boolean).map(String))] : [];
  const msg = await WhatsappMessage.create({
    conversation: conversationId,
    direction: 'outbound',
    type: 'text',
    text,
    internal: true,
    mentions: mentionIds,
    status: 'sent',
    timestamp: new Date(),
    sentByUser: user._id,
  });
  conv.lastMessage = { preview: '📝 Internal note', at: msg.timestamp, direction: 'outbound' };
  conv.lastMessageAt = msg.timestamp;
  await conv.save();
  // Let teammates assigned to this conversation see the note in realtime.
  emitToUsers(io, recipientUserIds(conv), 'wa:message:new', { ...toMessageDTO(msg), conversationId });
  // Notify anyone @mentioned in the note (excluding the author).
  const notifyIds = mentionIds.filter((id) => id !== String(user._id));
  notificationsService.createWhatsappNotification(
    io,
    notifyIds,
    `${user.name || 'A teammate'} mentioned you in a note on ${displayName(conv)}'s chat`,
    {
      studentId: conv.student ? conv.student._id : undefined,
      conversationId: conv._id,
      createdBy: user._id,
    }
  );
  return toMessageDTO(msg);
};

const audioExt = (mime = '') => {
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('mp4') || mime.includes('m4a')) return 'm4a';
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3';
  return 'ogg';
};

/**
 * Send a recorded voice note (multer file). Free-form, so honours the 24h window.
 * NOTE: WhatsApp only accepts OGG/OPUS (and a few others) for audio — browsers
 * often record audio/webm. For guaranteed delivery to the customer, transcode
 * the uploaded blob to ogg/opus (e.g. ffmpeg) before sending. In-app playback +
 * storage work regardless of format.
 */
const sendVoice = async (io, conversationId, file, clientRef, durationSec, user) => {
  const conv = await WhatsappConversation.findById(conversationId);
  if (!conv) throw new ApiError(httpStatus.NOT_FOUND, 'Conversation not found');
  if (windowStatusOf(conv.windowExpiresAt) === 'closed') throw windowClosedError();
  const mime = (file && file.mimetype) || 'audio/ogg';
  let link;
  if (file && file.buffer) {
    try {
      link = await firebase.uploadBuffer(file.buffer, `whatsapp/out/voice-${Date.now()}.${audioExt(mime)}`, mime);
    } catch (e) {
      link = undefined;
    }
  }
  const resp = await waClient.sendMedia(conv.contact.phone, { type: 'audio', link });
  const waMessageId = resp && resp.messages && resp.messages[0] && resp.messages[0].id;
  const msg = await WhatsappMessage.create({
    conversation: conversationId,
    waMessageId,
    clientRef,
    direction: 'outbound',
    type: 'audio',
    media: { mediaId: link || `voice-${Date.now()}`, url: link, mimeType: mime, type: 'audio' },
    durationSec: durationSec ? Number(durationSec) : undefined,
    status: 'sent',
    timestamp: new Date(),
    sentByUser: user._id,
  });
  conv.lastMessage = { preview: '🎤 Voice note', at: msg.timestamp, direction: 'outbound' };
  conv.lastMessageAt = msg.timestamp;
  await conv.save();
  return toMessageDTO(msg);
};

/** Update conversation triage: tags, priority, status (resolve/reopen), follow-up. */
const updateConversationMeta = async (conversationId, patch) => {
  const conv = await WhatsappConversation.findById(conversationId).populate(
    'student',
    'firstName lastName stage assignedTo nationality residence testScore ambassadorName source emergencyContact importantComment'
  );
  if (!conv) throw new ApiError(httpStatus.NOT_FOUND, 'Conversation not found');
  if (patch.status !== undefined) conv.status = patch.status;
  if (patch.priority !== undefined) conv.priority = patch.priority;
  if (patch.tags !== undefined) conv.tags = patch.tags;
  if (patch.nextFollowUpAt !== undefined) conv.nextFollowUpAt = patch.nextFollowUpAt;
  await conv.save();
  return toConversationDTO(conv);
};

/** Store an uploaded file (multer memory) and return a media reference for sending. */
const uploadMedia = async (file) => {
  const type = mediaTypeFromMime(file.mimetype);
  let url;
  try {
    const safe = String(file.originalname || 'file').replace(/[^\w.-]/g, '_');
    url = await firebase.uploadBuffer(file.buffer, `whatsapp/out/${Date.now()}-${safe}`, file.mimetype);
  } catch (e) {
    url = undefined;
  }
  // mediaId doubles as the send reference: a public URL is sent to Meta as a link.
  return {
    mediaId: url || `nolink-${Date.now()}`,
    url,
    mimeType: file.mimetype,
    type,
    size: file.size,
    filename: file.originalname,
  };
};

const listTemplates = async () => {
  const raw = await waClient.listTemplates();
  return (raw || []).filter((t) => !t.status || t.status === 'APPROVED').map(mapTemplate);
};

/**
 * Report integration readiness for the setup UI — booleans only, never the
 * secret values. `live` mode flips on automatically once the token + phone
 * number id are present (see thirdparty/whatsapp.isLive).
 */
const getIntegrationStatus = (baseUrl) => {
  const wa = config.whatsapp;
  const present = (v) => Boolean(v);
  const checklist = {
    phoneNumberId: present(wa.phoneNumberId),
    accessToken: present(wa.token),
    wabaId: present(wa.wabaId),
    webhookVerifyToken: present(wa.webhookVerifyToken),
    appSecret: present(wa.appSecret),
  };
  const missing = Object.entries(checklist)
    .filter(([, ok]) => !ok)
    .map(([key]) => key);
  const base = (baseUrl || config.host || '').replace(/\/$/, '');
  return {
    mode: waClient.isLive() ? 'live' : 'stub',
    apiVersion: wa.apiVersion,
    checklist,
    missing,
    webhook: {
      callbackUrl: base ? `${base}/v1/whatsapp/webhook` : '<host>/v1/whatsapp/webhook',
      verifyTokenConfigured: present(wa.webhookVerifyToken),
      subscribeFields: ['messages'],
    },
    requiredFromMeta: [
      { env: 'WHATSAPP_PHONE_NUMBER_ID', where: 'WhatsApp → API Setup → Phone number ID' },
      {
        env: 'WHATSAPP_TOKEN',
        where: 'System User → permanent token (whatsapp_business_messaging, whatsapp_business_management)',
      },
      { env: 'WHATSAPP_WABA_ID', where: 'WhatsApp → API Setup → WhatsApp Business Account ID' },
      { env: 'WHATSAPP_APP_SECRET', where: 'App Settings → Basic → App Secret' },
      { env: 'WHATSAPP_WEBHOOK_VERIFY_TOKEN', where: 'A secret you invent; must match the Meta webhook config' },
    ],
  };
};

module.exports = {
  processWebhook,
  queryConversations,
  getConversation,
  listMessages,
  markRead,
  assignConversation,
  sendText,
  sendTemplate,
  sendMedia,
  addNote,
  sendVoice,
  updateConversationMeta,
  uploadMedia,
  listTemplates,
  getIntegrationStatus,
};
