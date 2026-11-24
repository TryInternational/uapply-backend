const { WhatsappMessage, WhatsappConversation, Students, User } = require('../models');
const { WAITING_FILTER, firstUnanswered } = require('./whatsappWaiting.service');

/**
 * WhatsApp analytics — the numbers behind the management dashboards.
 * Every metric is aggregated from real data (WhatsappMessage / WhatsappConversation
 * / Students); nothing is fabricated. Metrics the current schema can't support
 * (CSAT, marketing lead-source) are intentionally omitted rather than faked.
 *
 * Timezone: every day and hour is a KUWAIT day and hour, whatever clock the
 * server runs on. "Today" starts at 00:00 Kuwait time; the 14-day charts are
 * labelled with Kuwait dates. (The windows used the server's own midnight: on
 * a UTC server "today" began at 03:00 Kuwait time, and on a machine east of
 * Kuwait every day of the 14-day charts was labelled one day early, with
 * today's messages on no bar at all.)
 *
 * One rule for "the student is waiting": the chat is not resolved and its last
 * real message is the student's (the inbox's "Needs reply" chip). The KPI, the
 * "Waiting longest" list and each person's Pending all count that same set.
 */

const TZ = 'Asia/Kuwait';
const KUWAIT_OFFSET_MS = 3 * 60 * 60 * 1000; // UTC+3 all year, no daylight saving
const DAY_MS = 24 * 60 * 60 * 1000;
const TREND_DAYS = 14;
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

/** The Kuwait calendar day an instant falls in, as "YYYY-MM-DD". */
const kuwaitDayKey = (d) => new Date(new Date(d).getTime() + KUWAIT_OFFSET_MS).toISOString().slice(0, 10);

/** 00:00 Kuwait time on the Kuwait day `now` falls in, `daysBack` days earlier. */
const kuwaitDayStart = (now = new Date(), daysBack = 0) => {
  const local = new Date(new Date(now).getTime() + KUWAIT_OFFSET_MS);
  const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  return new Date(midnight - daysBack * DAY_MS - KUWAIT_OFFSET_MS);
};

/** The last `n` Kuwait days up to and including today, oldest first. */
const lastKuwaitDays = (n, now = new Date()) =>
  Array.from({ length: n }, (_, i) => kuwaitDayKey(kuwaitDayStart(now, n - 1 - i)));

/**
 * today → from 00:00 Kuwait time today; 7d / 30d → that many Kuwait days
 * including today. An unknown range is "today", as before.
 */
const rangeToWindow = (range, now = new Date()) => {
  let back = 0;
  if (range === '7d') back = 6;
  else if (range === '30d') back = 29;
  return { start: kuwaitDayStart(now, back), end: new Date(now) };
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
  // internal notes are outbound rows too, but nothing reached the student
  const msgs = await WhatsappMessage.find(
    { timestamp: { $gte: start, $lte: end }, internal: { $ne: true } },
    'conversation direction timestamp sentByUser'
  )
    .sort({ conversation: 1, timestamp: 1 })
    .lean();

  const global = [];
  let globalLate = 0;
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
      if (sec > SLA_SECONDS) globalLate += 1;
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
  return { globalAvg: avg(global), globalCount: global.length, globalLate, byUser, avg };
};

/**
 * The chats where the student is waiting, longest wait first — the rule and
 * the clock are whatsappWaiting.service's, shared with the inbox.
 */
const waitingConversations = async () => {
  const convs = await WhatsappConversation.find(WAITING_FILTER, 'contact student assignees lastMessageAt').lean();
  if (!convs.length) return [];
  const open = await firstUnanswered(convs);
  const time = (c) => (c.since ? new Date(c.since).getTime() : Infinity);
  return convs
    .map((c) => {
      const o = open.get(String(c._id));
      return { ...c, since: (o && o.since) || c.lastMessageAt || null, unanswered: o ? o.unanswered : 0 };
    })
    .sort((a, b) => time(a) - time(b));
};

/** the assignee ids of a chat, each once (a person can hold two roles on a student) */
const assigneeIds = (conv) =>
  Array.from(new Set((conv.assignees || []).map((a) => a && a.userId && String(a.userId)).filter(Boolean)));

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

const overview = async (range = 'today', now = new Date()) => {
  const { start, end } = rangeToWindow(range, now);

  const [msgAgg] = await WhatsappMessage.aggregate([
    { $match: { timestamp: { $gte: start, $lte: end }, internal: { $ne: true } } },
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
    internal: { $ne: true },
    timestamp: { $gte: start, $lte: end },
  });

  // the state of the inbox right now (not range-bound)
  const nowDate = new Date(now);
  const openConversations = await WhatsappConversation.countDocuments({ status: { $ne: 'resolved' } });
  const unlinked = await WhatsappConversation.countDocuments({ status: { $ne: 'resolved' }, student: null });
  const followUpsOverdue = await WhatsappConversation.countDocuments({
    status: { $ne: 'resolved' },
    nextFollowUpAt: { $lt: nowDate },
  });
  // what happened in the range
  // by the moment it was marked resolved; a chat resolved before that moment
  // was recorded has only its last change to go by
  const resolved = await WhatsappConversation.countDocuments({
    status: 'resolved',
    $or: [{ resolvedAt: { $gte: start, $lte: end } }, { resolvedAt: null, updatedAt: { $gte: start, $lte: end } }],
  });
  const docsFiled = await WhatsappMessage.countDocuments({
    'savedDocument.id': { $ne: null },
    timestamp: { $gte: start, $lte: end },
  });
  const templatesSent = await WhatsappMessage.countDocuments({
    direction: 'outbound',
    type: 'template',
    timestamp: { $gte: start, $lte: end },
  });

  // unread messages in the chats still open — what the inbox's Unread chip adds up
  const [unreadAgg] = await WhatsappConversation.aggregate([
    { $match: { status: { $ne: 'resolved' } } },
    { $group: { _id: null, unread: { $sum: '$unreadCount' } } },
  ]);

  const newConversations = await WhatsappConversation.countDocuments({ createdAt: { $gte: start, $lte: end } });

  const waitingAll = await waitingConversations();
  const waitingCount = waitingAll.length;
  const waitingTop = waitingAll.slice(0, 8);
  const waitingStudentIds = waitingTop.map((c) => c.student).filter(Boolean);
  const waitingStudents = waitingStudentIds.length
    ? await Students.find({ _id: { $in: waitingStudentIds } }, 'firstName lastName stage').lean()
    : [];
  const studentOf = new Map(waitingStudents.map((st) => [String(st._id), st]));
  const waiting = waitingTop.map((c) => {
    const contact = c.contact || {};
    const student = (c.student && studentOf.get(String(c.student))) || {};
    const studentName = [student.firstName, student.lastName].filter(Boolean).join(' ');
    const owners = assigneeIds(c);
    return {
      conversationId: String(c._id),
      name: contact.name || studentName || contact.phone,
      stage: student.stage,
      assignee: owners[0] || null,
      unlinked: !c.student,
      waitingSec: c.since ? Math.max(0, Math.round((nowDate - new Date(c.since)) / 1000)) : 0,
      // how many messages they have sent since the last reply
      unanswered: c.unanswered,
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
    { $match: { timestamp: { $gte: start, $lte: end }, internal: { $ne: true } } },
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

  // new conversations, last 14 Kuwait days (today included)
  const trendStart = kuwaitDayStart(now, TREND_DAYS - 1);
  const trendDays = lastKuwaitDays(TREND_DAYS, now);
  const trendAgg = await WhatsappConversation.aggregate([
    { $match: { createdAt: { $gte: trendStart, $lte: end } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: TZ } }, c: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);
  const trendMap = Object.fromEntries(trendAgg.map((t) => [t._id, t.c]));
  const newConversationsTrend = trendDays.map((key) => ({ date: key, count: trendMap[key] || 0 }));

  // messages sent/received per day, last 14 Kuwait days
  const msgDayAgg = await WhatsappMessage.aggregate([
    { $match: { timestamp: { $gte: trendStart, $lte: end }, internal: { $ne: true } } },
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
  const messagesPerDay = trendDays.map((key) => {
    const v = msgDayMap[key] || { sent: 0, received: 0 };
    return { date: key, sent: v.sent, received: v.received };
  });

  const resp = await computeResponseTimes(start, end);

  return {
    range,
    // the window the range-bound figures cover, and the moment "now" was read
    window: { start: start.toISOString(), end: end.toISOString(), timezone: TZ },
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
      lateReplies: resp.globalLate,
      repeatedQuestions: rep ? rep.questions : 0,
      repeatedMessages: rep ? rep.messages : 0,
      openConversations,
      unlinked,
      followUpsOverdue,
      resolved,
      docsFiled,
      templatesSent,
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

const team = async (range = '7d', now = new Date()) => {
  const { start, end } = rangeToWindow(range, now);

  const sentAgg = await WhatsappMessage.aggregate([
    {
      $match: {
        direction: 'outbound',
        internal: { $ne: true },
        timestamp: { $gte: start, $lte: end },
        sentByUser: { $ne: null },
      },
    },
    {
      $group: {
        _id: '$sentByUser',
        sent: { $sum: 1 },
        voice: { $sum: { $cond: [{ $eq: ['$type', 'audio'] }, 1, 0] } },
        conversations: { $addToSet: '$conversation' },
      },
    },
  ]);

  // pending: the chats waiting for a reply (the overview's set — resolved chats
  // were counted here and not there), once per person who owns the chat
  const pendingMap = {};
  (await waitingConversations()).forEach((c) =>
    assigneeIds(c).forEach((uid) => {
      pendingMap[uid] = (pendingMap[uid] || 0) + 1;
    })
  );

  // open chats, overdue follow-ups and chats not yet on a student, per assignee
  // (state now). Each chat counts once per person, whatever roles they hold on
  // it. A chat with no follow-up date is not overdue, and one with no student
  // is unlinked whether the field is null or absent — the comparisons used
  // here treated a missing date as "before now" and a missing student as linked.
  const stateAgg = await WhatsappConversation.aggregate([
    { $match: { status: { $ne: 'resolved' } } },
    { $unwind: '$assignees' },
    { $match: { 'assignees.userId': { $ne: null } } },
    {
      $group: {
        _id: { c: '$_id', u: '$assignees.userId' },
        nextFollowUpAt: { $first: '$nextFollowUpAt' },
        student: { $first: '$student' },
      },
    },
    {
      $group: {
        _id: '$_id.u',
        open: { $sum: 1 },
        overdue: {
          $sum: {
            $cond: [
              { $and: [{ $eq: [{ $type: '$nextFollowUpAt' }, 'date'] }, { $lt: ['$nextFollowUpAt', new Date(now)] }] },
              1,
              0,
            ],
          },
        },
        unlinked: { $sum: { $cond: [{ $eq: [{ $ifNull: ['$student', null] }, null] }, 1, 0] } },
      },
    },
  ]);
  const stateMap = Object.fromEntries(stateAgg.map((r) => [String(r._id), r]));

  // replies per day, last 14 Kuwait days, per person (the counsellor's own chart)
  const trendStart = kuwaitDayStart(now, TREND_DAYS - 1);
  const perDayAgg = await WhatsappMessage.aggregate([
    {
      $match: {
        direction: 'outbound',
        internal: { $ne: true },
        sentByUser: { $ne: null },
        timestamp: { $gte: trendStart, $lte: end },
      },
    },
    {
      $group: {
        _id: { u: '$sentByUser', d: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp', timezone: TZ } } },
        c: { $sum: 1 },
      },
    },
  ]);
  const perDayMap = {};
  perDayAgg.forEach((r) => {
    const u = String(r._id.u);
    if (!perDayMap[u]) perDayMap[u] = {};
    perDayMap[u][r._id.d] = r.c;
  });
  const days = lastKuwaitDays(TREND_DAYS, now);

  const resp = await computeResponseTimes(start, end);

  const extraIds = Object.keys({ ...pendingMap, ...stateMap }).filter((id) => !sentAgg.some((s) => String(s._id) === id));
  extraIds.forEach((id) => sentAgg.push({ _id: id, sent: 0, voice: 0, conversations: [] }));
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
      openConversations: (stateMap[uid] && stateMap[uid].open) || 0,
      followUpsOverdue: (stateMap[uid] && stateMap[uid].overdue) || 0,
      unlinked: (stateMap[uid] && stateMap[uid].unlinked) || 0,
      avgResponseSec: resp.avg(ru.responses),
      lateReplies: ru.late,
      perDay: days.map((d) => ({ date: d, sent: (perDayMap[uid] && perDayMap[uid][d]) || 0 })),
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
    window: { start: start.toISOString(), end: end.toISOString(), timezone: TZ },
    totals: {
      messagesSent: totals.messagesSent,
      conversationsHandled: totals.conversationsHandled,
      lateReplies: totals.lateReplies,
      avgResponseSec: resp.globalAvg,
    },
    counselors: rows,
  };
};

module.exports = {
  overview,
  team,
  // exported for the tests
  rangeToWindow,
  kuwaitDayKey,
  kuwaitDayStart,
  lastKuwaitDays,
  computeResponseTimes,
  waitingConversations,
  SLA_SECONDS,
};
