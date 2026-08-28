const { WhatsappMessage, WhatsappConversation, User } = require('../models');

/**
 * WhatsApp analytics — the numbers behind the management dashboards.
 * Every metric is aggregated from real data (WhatsappMessage / WhatsappConversation
 * / Students); nothing is fabricated. Metrics the current schema can't support
 * (CSAT, marketing lead-source) are intentionally omitted rather than faked.
 *
 * Timezone: hour/day buckets use Asia/Kuwait so "today" matches the team's clock.
 */

const TZ = 'Asia/Kuwait';
const SLA_SECONDS = 15 * 60; // a reply slower than this counts as "late"

// Ordered, friendly labels for the real Students.stage enum.
const STAGE_ORDER = [
  { key: 'NotApplied', label: 'New / Not applied' },
  { key: 'PendingReview', label: 'Pending review' },
  { key: 'Applied', label: 'Applied' },
  { key: 'Enrolled', label: 'Enrolled' },
  { key: 'Lost', label: 'Lost' },
  { key: 'Denied', label: 'Denied' },
];

const rangeToWindow = (range) => {
  const end = new Date();
  const start = new Date(end);
  if (range === '7d') start.setDate(end.getDate() - 6);
  else if (range === '30d') start.setDate(end.getDate() - 29);
  else start.setHours(0, 0, 0, 0); // 'today' (default)
  if (range === '7d' || range === '30d') start.setHours(0, 0, 0, 0);
  return { start, end };
};

const initials = (name = '') =>
  name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase() || '?';

/**
 * Walk messages in time order per conversation, pairing each inbound with the
 * first outbound that answers it. Returns global + per-responder response times.
 */
const computeResponseTimes = async (start, end) => {
  const msgs = await WhatsappMessage.find(
    { timestamp: { $gte: start, $lte: end } },
    'conversation direction timestamp sentByUser'
  )
    .sort({ conversation: 1, timestamp: 1 })
    .lean();

  const global = [];
  const byUser = {}; // userId -> { responses: [sec], late: n }
  let curConv = null;
  let pendingInboundAt = null;

  msgs.forEach((m) => {
    const conv = String(m.conversation);
    if (conv !== curConv) {
      curConv = conv;
      pendingInboundAt = null;
    }
    if (m.direction === 'inbound') {
      if (pendingInboundAt === null) pendingInboundAt = m.timestamp;
    } else if (m.direction === 'outbound' && pendingInboundAt !== null) {
      const sec = Math.max(0, Math.round((new Date(m.timestamp) - new Date(pendingInboundAt)) / 1000));
      global.push(sec);
      const uid = m.sentByUser ? String(m.sentByUser) : null;
      if (uid) {
        if (!byUser[uid]) byUser[uid] = { responses: [], late: 0 };
        byUser[uid].responses.push(sec);
        if (sec > SLA_SECONDS) byUser[uid].late += 1;
      }
      pendingInboundAt = null;
    }
  });

  const avg = (arr) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0);
  return { globalAvg: avg(global), globalCount: global.length, byUser, avg };
};

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

const overview = async (range = 'today') => {
  const { start, end } = rangeToWindow(range);

  const [msgAgg] = await WhatsappMessage.aggregate([
    { $match: { timestamp: { $gte: start, $lte: end } } },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        sent: { $sum: { $cond: [{ $eq: ['$direction', 'outbound'] }, 1, 0] } },
        received: { $sum: { $cond: [{ $eq: ['$direction', 'inbound'] }, 1, 0] } },
        voiceSent: {
          $sum: { $cond: [{ $and: [{ $eq: ['$direction', 'outbound'] }, { $eq: ['$type', 'audio'] }] }, 1, 0] },
        },
        voiceReceived: {
          $sum: { $cond: [{ $and: [{ $eq: ['$direction', 'inbound'] }, { $eq: ['$type', 'audio'] }] }, 1, 0] },
        },
      },
    },
  ]);
  const m = msgAgg || { total: 0, sent: 0, received: 0, voiceSent: 0, voiceReceived: 0 };

  const handled = await WhatsappMessage.distinct('conversation', {
    direction: 'outbound',
    timestamp: { $gte: start, $lte: end },
  });

  const [unreadAgg] = await WhatsappConversation.aggregate([{ $group: { _id: null, unread: { $sum: '$unreadCount' } } }]);

  const newConversations = await WhatsappConversation.countDocuments({ createdAt: { $gte: start, $lte: end } });

  const waitingFilter = { 'lastMessage.direction': 'inbound' };
  const waitingCount = await WhatsappConversation.countDocuments(waitingFilter);
  const waitingDocs = await WhatsappConversation.find(waitingFilter)
    .sort({ lastMessageAt: 1 })
    .limit(8)
    .populate('student', 'firstName lastName stage')
    .lean();
  const now = Date.now();
  const waiting = waitingDocs.map((c) => {
    const contact = c.contact || {};
    const student = c.student || {};
    const studentName = [student.firstName, student.lastName].filter(Boolean).join(' ');
    return {
      conversationId: String(c._id),
      name: contact.name || studentName || contact.phone,
      stage: student.stage,
      assignee: c.assignees && c.assignees[0] ? String(c.assignees[0].userId) : null,
      waitingSec: c.lastMessageAt ? Math.round((now - new Date(c.lastMessageAt)) / 1000) : 0,
    };
  });

  // repeated inbound text
  const [rep] = await WhatsappMessage.aggregate([
    { $match: { direction: 'inbound', type: 'text', timestamp: { $gte: start, $lte: end }, text: { $nin: [null, ''] } } },
    { $group: { _id: { $toLower: { $trim: { input: '$text' } } }, c: { $sum: 1 } } },
    { $match: { c: { $gt: 1 } } },
    { $group: { _id: null, questions: { $sum: 1 }, messages: { $sum: '$c' } } },
  ]);

  // messages by hour (Kuwait time)
  const hourAgg = await WhatsappMessage.aggregate([
    { $match: { timestamp: { $gte: start, $lte: end } } },
    {
      $group: {
        _id: { h: { $hour: { date: '$timestamp', timezone: TZ } }, dir: '$direction' },
        c: { $sum: 1 },
      },
    },
  ]);
  const messagesByHour = Array.from({ length: 24 }, (_, h) => ({ hour: h, sent: 0, received: 0 }));
  hourAgg.forEach((r) => {
    const bucket = messagesByHour[r._id.h];
    if (!bucket) return;
    if (r._id.dir === 'outbound') bucket.sent = r.c;
    else if (r._id.dir === 'inbound') bucket.received = r.c;
  });

  // funnel by real student stage — scoped to students we actually talk to on
  // WhatsApp (i.e. who have a conversation), so it reflects WABA pipeline, not
  // the whole CRM.
  const stageAgg = await WhatsappConversation.aggregate([
    { $match: { student: { $ne: null } } },
    { $group: { _id: '$student' } },
    { $lookup: { from: 'students', localField: '_id', foreignField: '_id', as: 'st' } },
    { $unwind: '$st' },
    { $group: { _id: '$st.stage', c: { $sum: 1 } } },
  ]);
  const stageMap = Object.fromEntries(stageAgg.map((s) => [s._id, s.c]));
  const funnel = STAGE_ORDER.map((s) => ({ key: s.key, label: s.label, count: stageMap[s.key] || 0 }));

  // new conversations, last 14 days trend
  const trendStart = new Date();
  trendStart.setDate(trendStart.getDate() - 13);
  trendStart.setHours(0, 0, 0, 0);
  const trendAgg = await WhatsappConversation.aggregate([
    { $match: { createdAt: { $gte: trendStart } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: TZ } }, c: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);
  const trendMap = Object.fromEntries(trendAgg.map((t) => [t._id, t.c]));
  const newConversationsTrend = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(trendStart);
    d.setDate(trendStart.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    return { date: key, count: trendMap[key] || 0 };
  });

  // messages sent/received per day, last 14 days (Kuwait time)
  const msgDayAgg = await WhatsappMessage.aggregate([
    { $match: { timestamp: { $gte: trendStart } } },
    {
      $group: {
        _id: { d: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp', timezone: TZ } }, dir: '$direction' },
        c: { $sum: 1 },
      },
    },
  ]);
  const msgDayMap = {};
  msgDayAgg.forEach((r) => {
    const key = r._id.d;
    if (!msgDayMap[key]) msgDayMap[key] = { sent: 0, received: 0 };
    if (r._id.dir === 'outbound') msgDayMap[key].sent = r.c;
    else if (r._id.dir === 'inbound') msgDayMap[key].received = r.c;
  });
  const messagesPerDay = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(trendStart);
    d.setDate(trendStart.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    const v = msgDayMap[key] || { sent: 0, received: 0 };
    return { date: key, sent: v.sent, received: v.received };
  });

  const resp = await computeResponseTimes(start, end);

  return {
    range,
    kpis: {
      messagesTotal: m.total,
      messagesSent: m.sent,
      messagesReceived: m.received,
      voiceSent: m.voiceSent,
      voiceReceived: m.voiceReceived,
      unread: unreadAgg ? unreadAgg.unread : 0,
      conversationsHandled: handled.length,
      newConversations,
      waitingForReply: waitingCount,
      avgResponseSec: resp.globalAvg,
      repeatedQuestions: rep ? rep.questions : 0,
      repeatedMessages: rep ? rep.messages : 0,
    },
    messagesByHour,
    messagesPerDay,
    funnel,
    waiting,
    newConversationsTrend,
  };
};

// ---------------------------------------------------------------------------
// Team performance
// ---------------------------------------------------------------------------

const team = async (range = '7d') => {
  const { start, end } = rangeToWindow(range);

  const sentAgg = await WhatsappMessage.aggregate([
    { $match: { direction: 'outbound', timestamp: { $gte: start, $lte: end }, sentByUser: { $ne: null } } },
    {
      $group: {
        _id: '$sentByUser',
        sent: { $sum: 1 },
        voice: { $sum: { $cond: [{ $eq: ['$type', 'audio'] }, 1, 0] } },
        conversations: { $addToSet: '$conversation' },
      },
    },
  ]);

  // pending (awaiting-reply) conversations per assigned user
  const pendingAgg = await WhatsappConversation.aggregate([
    { $match: { 'lastMessage.direction': 'inbound' } },
    { $unwind: '$assignees' },
    { $group: { _id: '$assignees.userId', pending: { $sum: 1 } } },
  ]);
  const pendingMap = Object.fromEntries(pendingAgg.map((p) => [String(p._id), p.pending]));

  const resp = await computeResponseTimes(start, end);

  const userIds = sentAgg.map((s) => s._id).filter(Boolean);
  const users = await User.find({ _id: { $in: userIds } }, 'name avatar').lean();
  const userMap = Object.fromEntries(users.map((u) => [String(u._id), u]));

  let rows = sentAgg.map((s) => {
    const uid = String(s._id);
    const u = userMap[uid] || {};
    const ru = resp.byUser[uid] || { responses: [], late: 0 };
    return {
      userId: uid,
      name: u.name || 'Unknown',
      initials: initials(u.name),
      avatar: u.avatar,
      messagesSent: s.sent,
      voiceSent: s.voice,
      conversationsHandled: s.conversations.length,
      pending: pendingMap[uid] || 0,
      avgResponseSec: resp.avg(ru.responses),
      lateReplies: ru.late,
    };
  });

  rows.sort((a, b) => b.conversationsHandled - a.conversationsHandled || b.messagesSent - a.messagesSent);
  rows = rows.map((r, i) => ({ ...r, rank: i + 1 }));

  const totals = rows.reduce(
    (acc, r) => {
      acc.messagesSent += r.messagesSent;
      acc.conversationsHandled += r.conversationsHandled;
      acc.lateReplies += r.lateReplies;
      return acc;
    },
    { messagesSent: 0, conversationsHandled: 0, lateReplies: 0 }
  );

  return {
    range,
    totals: {
      messagesSent: totals.messagesSent,
      conversationsHandled: totals.conversationsHandled,
      lateReplies: totals.lateReplies,
      avgResponseSec: resp.globalAvg,
    },
    counselors: rows,
  };
};

module.exports = { overview, team };
