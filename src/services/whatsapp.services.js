const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const httpStatus = require('http-status');
const ApiError = require('../utils/ApiError');
const config = require('../config/config');
const logger = require('../config/logger');
const { WhatsappConversation, WhatsappMessage, Students, Application, CourseLevels, User, Documents } = require('../models');

// What the inbox's contact panel shows about a linked student.
const STUDENT_FIELDS =
  'firstName lastName email phoneNo refrenceNo stage assignedTo nationality residence city dob gender ' +
  'testScore testTaken englishTest previousSchool cgpa backlogs educationGaps passportStatus passportExpiry ' +
  'ambassadorName source channel emergencyContact importantComment preference labels lostReason lost onHold ' +
  'isClosed qualified createdAt';
const { whatsapp: waClient } = require('../thirdparty');
const firebase = require('../thirdparty/firebase');
const notificationsService = require('./notifications.services');
// Which roles are admin comes from the roles collection, not from ids pasted
// here. Admins may view the Unassigned / All inboxes; everyone else is scoped
// to their own chats.
const roleAccess = require('./roleAccess.service');
// Required lazily: both modules import models/thirdparty only, but keeping the
// require inside the handlers avoids any load-order surprise in services/index.
const broadcastService = () => require('./whatsappBroadcast.services'); // eslint-disable-line global-require
const callService = () => require('./whatsappCall.services'); // eslint-disable-line global-require

// Best-effort display name for a conversation (contact name → student → phone).
const displayName = (conv) => {
  const c = conv.contact || {};
  const s = conv.student || {};
  const sName = [s.firstName, s.lastName].filter(Boolean).join(' ').trim();
  return c.name || sName || c.phone || 'a contact';
};

const WINDOW_MS = 24 * 60 * 60 * 1000;
// Delivery receipts only move forward through these; see handleStatusUpdates.
const STATUS_RANK = { sent: 1, delivered: 2, read: 3, failed: 4 };

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
  // Stored numbers carry spaces and dashes ("+965 5123 4567") and the
  // Trello-era ones often have no country code ("51234567"), so the last 8
  // digits are matched with anything non-digit allowed between them.
  const tail = norm.slice(-8);
  const loose = tail.split('').map(escapeRegex).join('\\D*');
  return Students.findOne({ phoneNo: { $regex: `${loose}\\D*$` } }).select('firstName lastName stage assignedTo phoneNo');
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
  savedDocument:
    m.savedDocument && m.savedDocument.id
      ? { id: String(m.savedDocument.id), label: m.savedDocument.label, docTypeKey: m.savedDocument.docTypeKey }
      : undefined,
});

// Loose label from a free-form value (nationality/residence are stored as objects).
const labelOf = (v) => {
  if (!v) return undefined;
  if (typeof v === 'string') return v;
  return v.english_name || v.en_name || v.label || v.name || v.value || v.slug || undefined;
};
const listOf = (arr) => (Array.isArray(arr) ? arr.map(labelOf).filter(Boolean) : []);
const ageOf = (dob) => {
  if (!dob) return undefined;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return undefined;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  if (now < new Date(now.getFullYear(), d.getMonth(), d.getDate())) age -= 1;
  return age >= 0 && age < 120 ? age : undefined;
};
const CHANNEL_LABEL = {
  subagent: 'Sub-agent',
  counselor: 'School counsellor',
  lead: 'Online lead',
  direct: 'Walk-in',
  exhibition: 'Exhibition',
  referral: 'Referral',
  campaign: 'Campaign',
  other: 'Other',
};

const intakeLabel = (month, year) => [month, year].filter(Boolean).join(' ') || undefined;

/** Current phase / outcome of an application, in the words the back office uses. */
const applicationStatus = (a) => {
  const phases = (a.portalApplicationStatus && a.portalApplicationStatus.applicationPhases) || [];
  const current = phases.find((p) => p && p.isCurrent) || phases[phases.length - 1];
  if (a.rejected) return 'Rejected';
  if (current && current.closedStatus) return current.closedStatus;
  if (current && current.offerStatus) return `${current.status} · ${current.offerStatus}`;
  if (current && current.status) return current.status;
  if (Array.isArray(a.status) && a.status.length) return a.status[a.status.length - 1];
  return 'Submitted';
};

const isObjectId = (x) => /^[a-f\d]{24}$/i.test(String(x));

/** Human level name for an application: resolved id, else whatever text was stored. */
const applicationLevel = (a, lookups) => {
  const raw = a.courseLevel || (a.course && a.course.courseLevel);
  if (!raw) return undefined;
  const key = String(raw && raw._id ? raw._id : raw);
  if (lookups && lookups.levels && lookups.levels[key]) return lookups.levels[key];
  if (isObjectId(key)) return undefined; // unknown id: hide rather than show a hash
  return labelOf(raw);
};

// Back-office pipeline, used for the mini progress bar on the inbox card.
const APP_PHASES = [
  'Initiated',
  'Submitted',
  'Conditional offer',
  'Unconditional offer',
  'Confirmation',
  'FG/BS',
  'CAS Received',
  'Done',
];
const applicationPhaseIndex = (a) => {
  const phases = (a.portalApplicationStatus && a.portalApplicationStatus.applicationPhases) || [];
  let best = -1;
  phases.forEach((p) => {
    if (p && (p.isCurrent || p.phaseState === 'Completed')) best = Math.max(best, APP_PHASES.indexOf(p.status));
  });
  return best;
};

const DOC_STATE_RECEIVED = ['Upload', 'Received', 'Verified'];
const toDocumentDTO = (d) => {
  const first = Array.isArray(d.blobInfo) && d.blobInfo[0] ? d.blobInfo[0] : {};
  return {
    id: d._id.toString(),
    key: d.docTypeKey || undefined,
    // Raw labels too: older rows have no docTypeKey, and the CRM maps these
    // back to a type key (docKeyOfDoc) for the "still needed" check.
    documentType: d.documentType || undefined,
    subType: d.subType || undefined,
    name: d.subType || d.documentType || 'Document',
    state: d.docState || 'Not Uploaded',
    status: DOC_STATE_RECEIVED.includes(d.docState) ? 'received' : 'pending',
    files: Array.isArray(d.blobInfo) ? d.blobInfo.length : 0,
    url: first.blobUrl || first.url || undefined,
    fileName: first.fileName || first.name || undefined,
    updatedAt: d.updatedAt ? new Date(d.updatedAt).toISOString() : undefined,
  };
};

const toApplicationDTO = (a, lookups) => ({
  phaseIndex: applicationPhaseIndex(a),
  phaseCount: APP_PHASES.length,
  rejected: Boolean(a.rejected),
  id: a._id.toString(),
  applicationId: a.applicationId || undefined,
  university: (a.institute && a.institute.name) || (a.course && a.course.universityName) || 'Unknown institution',
  course: a.courseName || (a.course && a.course.name) || undefined,
  level: applicationLevel(a, lookups),
  intake: intakeLabel(a.intakeMonth, a.intakeYear),
  status: applicationStatus(a),
  finalChoice: Boolean(a.finalChoice),
  createdAt: a.createdAt ? new Date(a.createdAt).toISOString() : undefined,
});

const toConversationDTO = (conv) => {
  const s = conv.student;
  const pref = (s && s.preference) || {};
  const et = (s && s.englishTest) || {};
  const lookups = conv.lookups || {};
  const student =
    s && s._id
      ? {
          id: s._id.toString(),
          name: [s.firstName, s.lastName].filter(Boolean).join(' ').trim() || undefined,
          referenceNo: s.refrenceNo || undefined,
          stage: s.stage,
          flags: [
            s.isClosed && 'Closed',
            s.onHold && 'On hold',
            s.lost && 'Lost',
            s.qualified && 'Qualified',
            ...(Array.isArray(s.labels) ? s.labels : []),
          ].filter(Boolean),
          lostReason: s.lostReason || undefined,
          assignedTo: (s.assignedTo || []).map((a) => ({ user: a.user ? a.user.toString() : a.user, role: a.role })),
          counsellors: (s.assignedTo || [])
            .map((a) => ({ name: (a.user && lookups.users && lookups.users[String(a.user)]) || undefined, role: a.role }))
            .filter((c) => c.name),
          // Contact
          email: s.email || undefined,
          phone: s.phoneNo || undefined,
          nationality: labelOf(s.nationality) || undefined,
          residence: [s.city, labelOf(s.residence)].filter(Boolean).join(', ') || undefined,
          country: labelOf(s.nationality) || labelOf(s.residence),
          gender: s.gender || undefined,
          age: ageOf(s.dob),
          emergencyContacts: (s.emergencyContact || [])
            .map((e) => ({
              name: [e.firstName, e.lastName].filter(Boolean).join(' ').trim() || undefined,
              relation: e.relation || undefined,
              phone: e.emergencyContactNo || undefined,
            }))
            .filter((e) => e.phone || e.name),
          parentPhone: s.emergencyContact && s.emergencyContact[0] ? s.emergencyContact[0].emergencyContactNo : undefined,
          // Study plan
          studyPlan: {
            level: (lookups.levels && lookups.levels[String(pref.courseLevel)]) || labelOf(pref.courseLevel) || undefined,
            subjects: listOf(pref.courseSubjectIds),
            destinations: listOf(pref.destinations).length ? listOf(pref.destinations) : listOf([pref.studyDestinations]),
            universities: listOf(pref.universities),
            intake: intakeLabel(pref.intakeMonth, pref.intakeYear),
            provider: pref.provider || undefined,
            budget: pref.budgetRange || undefined,
            funding: pref.fundingSource || pref.sponsoredBy || pref.sponserName || undefined,
            needScholarship: Boolean(pref.needScholarship),
          },
          // English test
          englishTest:
            et.overall || s.testScore
              ? {
                  type: et.type || 'IELTS',
                  overall: et.overall || s.testScore,
                  listening: et.listening,
                  reading: et.reading,
                  writing: et.writing,
                  speaking: et.speaking,
                  testDate: et.testDate || undefined,
                }
              : undefined,
          testTaken: s.testTaken || undefined,
          ielts: s.testScore || (et.overall ? String(et.overall) : undefined),
          // Education + passport (no document numbers here)
          education: {
            school: s.previousSchool || undefined,
            cgpa: s.cgpa || undefined,
            backlogs: s.backlogs ? 'Yes' : undefined,
            educationGaps: s.educationGaps ? 'Yes' : undefined,
          },
          passport: { status: s.passportStatus || undefined, expiry: s.passportExpiry || undefined },
          // Origin
          channel: CHANNEL_LABEL[s.channel] || s.channel || undefined,
          leadSource: s.ambassadorName || s.source || undefined,
          notes: s.importantComment || undefined,
          since: s.createdAt ? new Date(s.createdAt).toISOString() : undefined,
          relatedApplications: Array.isArray(conv.applications)
            ? conv.applications.map((a) => toApplicationDTO(a, lookups))
            : undefined,
          documents: Array.isArray(conv.documents) ? conv.documents.map(toDocumentDTO) : undefined,
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

/**
 * Make sure each conversation is linked to the student record that owns its
 * phone number (a conversation created before the student existed, or by a
 * webhook race, has no link yet), and load that student's applications so the
 * contact panel can show them. Mutates the docs in place; one query per page.
 */
/* eslint-disable no-param-reassign */
const attachStudentContext = async (convs) => {
  const list = Array.isArray(convs) ? convs : [convs];
  await Promise.all(
    list.map(async (conv) => {
      if (conv.student && conv.student._id) return;
      const student = await findStudentByPhone(conv.contact.waId || conv.contact.phone);
      if (!student) return;
      conv.student = student._id;
      if (!conv.assignees || !conv.assignees.length) {
        conv.assignees = (student.assignedTo || []).filter((a) => a.user).map((a) => ({ userId: a.user, role: a.role }));
      }
      await conv.save();
      await conv.populate('student', STUDENT_FIELDS);
    })
  );
  const studentIds = [...new Set(list.filter((c) => c.student && c.student._id).map((c) => String(c.student._id)))];
  if (!studentIds.length) return list;
  const apps = await Application.find({ studentId: { $in: studentIds } })
    .select(
      'applicationId studentId institute courseName courseLevel intakeMonth intakeYear finalChoice rejected status portalApplicationStatus createdAt course'
    )
    .sort({ createdAt: -1 })
    .lean();
  const byStudent = {};
  apps.forEach((a) => {
    const k = String(a.studentId);
    (byStudent[k] = byStudent[k] || []).push(a);
  });
  const docs = await Documents.find({ studentId: { $in: studentIds } })
    .select('documentType subType docTypeKey docState blobInfo updatedAt studentId')
    .sort({ updatedAt: -1 })
    .lean();
  const docsByStudent = {};
  docs.forEach((d) => {
    const k = String(d.studentId && d.studentId._id ? d.studentId._id : d.studentId);
    (docsByStudent[k] = docsByStudent[k] || []).push(d);
  });
  // Resolve ids the student record stores (course level, counsellors) to names.
  const linked = list.filter((c) => c.student && c.student._id);
  const levelIds = [
    ...new Set(
      [
        ...linked.map((c) => c.student.preference && c.student.preference.courseLevel),
        ...apps.map((a) => a.courseLevel || (a.course && a.course.courseLevel)),
      ]
        .map((x) => (x && x._id ? String(x._id) : x))
        .filter(isObjectId)
    ),
  ];
  const userIds = [
    ...new Set(linked.flatMap((c) => (c.student.assignedTo || []).map((a) => a.user && String(a.user)).filter(Boolean))),
  ];
  const [levels, users] = await Promise.all([
    levelIds.length ? CourseLevels.find({ _id: { $in: levelIds } }).lean() : [],
    userIds.length
      ? User.find({ _id: { $in: userIds } })
          .select('name')
          .lean()
      : [],
  ]);
  const lookups = {
    levels: Object.fromEntries(levels.map((l) => [String(l._id), l.en_name || l.name])),
    users: Object.fromEntries(users.map((u) => [String(u._id), u.name])),
  };
  list.forEach((c) => {
    if (c.student && c.student._id) {
      c.applications = byStudent[String(c.student._id)] || [];
      c.documents = docsByStudent[String(c.student._id)] || [];
      c.lookups = lookups;
    }
  });
  return list;
};
/* eslint-enable no-param-reassign */

/**
 * Start (or reopen) a conversation with a phone number from the CRM, so staff can
 * open with a template before the customer has ever written in. If the number
 * belongs to a student, the conversation is linked and assigned like an inbound
 * one; the caller is added as an assignee so it shows up in their "mine" view.
 */
const startConversation = async (phone, name, reqUser) => {
  const waId = waClient.normalizeTo(phone);
  if (waId.length < 8) throw new ApiError(httpStatus.BAD_REQUEST, 'Enter the number with its country code');
  const conv = await upsertConversationByPhone(waId, name);
  if (reqUser && !(conv.assignees || []).some((a) => String(a.userId) === String(reqUser._id))) {
    conv.assignees.push({ userId: reqUser._id, role: 'counsellor' });
    await conv.save();
  }
  await conv.populate('student', STUDENT_FIELDS);
  await attachStudentContext(conv);
  return toConversationDTO(conv);
};

const handleInboundMessages = async (io, value) => {
  const profileName =
    value.contacts && value.contacts[0] && value.contacts[0].profile ? value.contacts[0].profile.name : undefined;
  await Promise.all(
    (value.messages || []).map(async (message) => {
      const { from } = message;
      // Meta retries a webhook until it gets a 2xx, so the same wamid can arrive
      // more than once. Never create a second copy of a message we already hold.
      if (message.id && (await WhatsappMessage.exists({ waMessageId: message.id }))) return;
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
      } else if (type === 'interactive' && message.interactive && message.interactive.type === 'call_permission_reply') {
        const reply = message.interactive.call_permission_reply || {};
        await callService().onPermissionReply(io, conv, reply);
        type = 'system';
        text = reply.response === 'accept' ? '✅ Allowed WhatsApp calls' : '🚫 Declined WhatsApp calls';
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
      await conv.populate('student', STUDENT_FIELDS);

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
      // Meta emits sent | delivered | read | failed, and the callbacks can land out
      // of order (a "read" before its "delivered"). Only ever move forward; a
      // failure always wins, since the message never reached the handset.
      const next = STATUS_RANK[st.status] === undefined ? -1 : STATUS_RANK[st.status];
      const current = STATUS_RANK[msg.status] === undefined ? -1 : STATUS_RANK[msg.status];
      if (st.status !== 'failed' && next <= current) return;
      msg.status = st.status;
      if (st.errors && st.errors[0]) {
        const err = st.errors[0];
        msg.error = { code: String(err.code), title: err.title || (err.error_data && err.error_data.details) };
      }
      await msg.save();
      if (msg.broadcast) {
        broadcastService()
          .onMessageStatus(io, msg)
          .catch((e) => logger.error(`[whatsapp] broadcast counter update failed: ${e.message}`));
      }

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
      if (change && change.field === 'calls') {
        await callService().handleCallEvents(io, value);
        return;
      }
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
  await WhatsappConversation.populate(result.results, { path: 'student', select: STUDENT_FIELDS });
  await attachStudentContext(result.results);
  return { ...result, results: result.results.map(toConversationDTO) };
};

const getConversation = async (id) => {
  const conv = await WhatsappConversation.findById(id).populate('student', STUDENT_FIELDS);
  if (!conv) throw new ApiError(httpStatus.NOT_FOUND, 'Conversation not found');
  await attachStudentContext(conv);
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
  await conv.populate('student', STUDENT_FIELDS);
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
const addNote = async (io, conversationId, text, mentions, user, clientRef) => {
  const conv = await WhatsappConversation.findById(conversationId).populate('student', 'firstName lastName assignedTo');
  if (!conv) throw new ApiError(httpStatus.NOT_FOUND, 'Conversation not found');
  const mentionIds = Array.isArray(mentions) ? [...new Set(mentions.filter(Boolean).map(String))] : [];
  const msg = await WhatsappMessage.create({
    conversation: conversationId,
    direction: 'outbound',
    type: 'text',
    text,
    clientRef,
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

/**
 * Transcode a browser recording (WebM/Opus, etc.) to AAC-LC in an MP4/M4A
 * container. WhatsApp accepts OGG/Opus too, but files produced by ffmpeg's
 * libopus are delivered yet unplayable in the iPhone app ("This audio is no
 * longer available") — verified 2026-10-21; AAC/M4A plays on iOS, Android and
 * Web. Returns null when ffmpeg is missing or fails, so the caller can fall
 * back to sending the original.
 */
const transcodeToAac = async (buffer) => {
  // A seekable MP4 (moov up front) is what the iPhone test played; ffmpeg can
  // only write that to a real file, so go through a temp file rather than a pipe.
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wa-voice-'));
  const inPath = path.join(dir, 'in');
  const outPath = path.join(dir, 'out.m4a');
  try {
    await fs.promises.writeFile(inPath, buffer);
    const ok = await new Promise((resolve) => {
      let ff;
      try {
        ff = spawn('ffmpeg', [
          '-hide_banner',
          '-loglevel',
          'error',
          '-y',
          '-i',
          inPath,
          '-vn',
          '-c:a',
          'aac',
          '-profile:a',
          'aac_low',
          '-b:a',
          '48k',
          '-ar',
          '48000',
          '-ac',
          '1',
          '-map_metadata',
          '-1',
          '-movflags',
          '+faststart',
          '-f',
          'mp4',
          outPath,
        ]);
      } catch (e) {
        resolve(false);
        return;
      }
      let stderr = '';
      ff.stderr.on('data', (c) => {
        stderr += c.toString();
      });
      ff.on('error', () => resolve(false));
      ff.on('close', (code) => {
        if (code !== 0) logger.warn(`[whatsapp] ffmpeg transcode failed (${code}): ${stderr.slice(0, 200)}`);
        resolve(code === 0);
      });
    });
    if (!ok) return null;
    const out = await fs.promises.readFile(outPath);
    return out.length ? out : null;
  } catch (e) {
    logger.warn(`[whatsapp] transcode error: ${e.message}`);
    return null;
  } finally {
    fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
};

const audioExt = (mime = '') => {
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('mp4') || mime.includes('aac')) return 'm4a';
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
  let mime = (file && file.mimetype) || 'audio/ogg';
  let buffer = file && file.buffer;
  // Convert everything that is not already AAC/M4A (see transcodeToAac).
  if (buffer && !/mp4|m4a|aac/.test(mime)) {
    const m4a = await transcodeToAac(buffer);
    if (m4a) {
      buffer = m4a;
      mime = 'audio/mp4';
    }
  }
  const waMime = /ogg|opus/.test(mime) ? 'audio/ogg; codecs=opus' : mime;
  let link;
  if (buffer) {
    try {
      link = await firebase.uploadBuffer(buffer, `whatsapp/out/voice-${Date.now()}.${audioExt(mime)}`, mime);
    } catch (e) {
      link = undefined;
    }
  }
  if (!link) throw new ApiError(httpStatus.BAD_GATEWAY, 'Could not store the voice note');
  // Push the bytes to Meta and send by media id; fall back to the public link.
  let mediaId;
  try {
    const up = await waClient.uploadMedia(buffer, waMime, `voice.${audioExt(mime)}`);
    mediaId = up && up.id;
  } catch (e) {
    logger.warn(`[whatsapp] media upload failed, sending by link: ${e.message}`);
  }
  const resp = await waClient.sendMedia(
    conv.contact.phone,
    mediaId ? { type: 'audio', id: mediaId } : { type: 'audio', link }
  );
  const waMessageId = resp && resp.messages && resp.messages[0] && resp.messages[0].id;
  const msg = await WhatsappMessage.create({
    conversation: conversationId,
    waMessageId,
    clientRef,
    direction: 'outbound',
    type: 'audio',
    media: { mediaId: mediaId || link || `voice-${Date.now()}`, url: link, mimeType: mime, type: 'audio' },
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

/**
 * File a document the student sent on WhatsApp straight into their student
 * record: the stored copy (already on our bucket) becomes a Documents row of
 * the chosen type, so it shows up in the profile's Documents panel and on the
 * application checklist without anyone re-uploading it.
 */
const saveMessageAsDocument = async (messageId, { docTypeKey, label, applicationId }, user) => {
  const msg = await WhatsappMessage.findById(messageId);
  if (!msg) throw new ApiError(httpStatus.NOT_FOUND, 'Message not found');
  if (msg.direction !== 'inbound' || !msg.media || !msg.media.url || !['image', 'document'].includes(msg.type)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Only a photo or document received from the student can be saved');
  }
  const conv = await WhatsappConversation.findById(msg.conversation);
  if (!conv) throw new ApiError(httpStatus.NOT_FOUND, 'Conversation not found');
  if (!conv.student) {
    const err = new ApiError(httpStatus.CONFLICT, 'This chat is not linked to a student record yet');
    err.code = 'NOT_LINKED';
    throw err;
  }
  if (msg.savedDocument && msg.savedDocument.id) {
    const err = new ApiError(httpStatus.CONFLICT, 'This file is already on the student record');
    err.code = 'ALREADY_SAVED';
    throw err;
  }
  const docLabel = label || docTypeKey || 'Document';
  const fileName =
    msg.media.filename ||
    `whatsapp-${msg.type}-${new Date(msg.timestamp).toISOString().slice(0, 10)}${mimeExt(msg.media.mimeType)}`;
  const doc = await Documents.create({
    studentId: conv.student,
    applicationId: applicationId || undefined,
    docTypeKey,
    documentType: docLabel,
    subType: docLabel,
    docState: 'Received',
    tag: {
      source: 'whatsapp',
      conversationId: String(conv._id),
      messageId: String(msg._id),
      savedBy: user ? String(user._id) : undefined,
    },
    blobInfo: [{ blobUrl: msg.media.url, fileName, name: fileName, mimeType: msg.media.mimeType }],
  });
  msg.savedDocument = { id: doc._id, label: docLabel, docTypeKey };
  await msg.save();
  try {
    // eslint-disable-next-line global-require
    const activitiesService = require('./activities.service');
    await activitiesService.logActivity({
      student: conv.student,
      type: 'doc',
      text: `${(user && user.name) || 'A counsellor'} saved ${docLabel} from WhatsApp`,
      actorId: user ? user._id : undefined,
      actorName: user ? user.name : undefined,
      meta: { docId: doc.id, conversationId: conv._id },
    });
  } catch (e) {
    logger.warn(`[whatsapp] activity log failed: ${e.message}`);
  }
  return { message: toMessageDTO(msg), document: toDocumentDTO(doc.toObject ? doc.toObject() : doc) };
};

/** Update conversation triage: tags, priority, status (resolve/reopen), follow-up. */
const updateConversationMeta = async (conversationId, patch) => {
  const conv = await WhatsappConversation.findById(conversationId).populate('student', STUDENT_FIELDS);
  if (!conv) throw new ApiError(httpStatus.NOT_FOUND, 'Conversation not found');
  if (patch.status !== undefined) conv.status = patch.status;
  if (patch.priority !== undefined) conv.priority = patch.priority;
  if (patch.tags !== undefined) conv.tags = patch.tags;
  if (patch.nextFollowUpAt !== undefined) conv.nextFollowUpAt = patch.nextFollowUpAt;
  if (patch.contactName !== undefined) {
    // Empty / null clears the staff-set name, so the next inbound message's
    // WhatsApp profile name (or the linked student) becomes the display name again.
    const name = patch.contactName ? String(patch.contactName).trim() : '';
    conv.contact.name = name || undefined;
    conv.markModified('contact');
  }
  if (patch.studentId !== undefined) {
    // Link by hand (the inbox's "Add as student" / "Convert lead" / "Link an
    // existing student"); the student's team becomes the chat's owners when
    // nobody owns it yet — the same as the automatic phone link.
    const student = await Students.findById(patch.studentId).select('firstName lastName stage assignedTo phoneNo');
    if (!student) throw new ApiError(httpStatus.NOT_FOUND, 'Student not found');
    conv.student = student._id;
    if (!conv.assignees || !conv.assignees.length) {
      conv.assignees = (student.assignedTo || []).filter((a) => a.user).map((a) => ({ userId: a.user, role: a.role }));
    }
  }
  await conv.save();
  if (patch.studentId !== undefined) {
    await conv.populate('student', STUDENT_FIELDS);
    await attachStudentContext(conv);
  }
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
  startConversation,
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
  saveMessageAsDocument,
  uploadMedia,
  listTemplates,
  getIntegrationStatus,
};
