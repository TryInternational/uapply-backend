/**
 * An independent recount of every figure the WhatsApp dashboards show, from
 * the raw conversation and message records — plain loops, no aggregation
 * pipelines, and its own Kuwait-time arithmetic (Intl), so it shares nothing
 * with src/services/whatsappAnalytics.services.js except the definitions.
 *
 * scripts/check-whatsapp-analytics.js runs both and prints where they differ.
 *
 * Definitions (the same ones the dashboard states):
 *   range      today = from 00:00 Kuwait time today; 7d / 30d = that many
 *              Kuwait days, today included; all end "now"
 *   message    internal notes are not messages (nothing reached the student)
 *   waiting    a chat that is not resolved whose last real message is the
 *              student's; the wait runs from their first unanswered message
 *   reply      the first outbound message after an inbound one, within the
 *              range; late = slower than 15 minutes
 */
const TZ = 'Asia/Kuwait';
const SLA_SECONDS = 15 * 60;
const TREND_DAYS = 14;
const STAGES = ['NotApplied', 'PendingReview', 'Applied', 'Enrolled', 'Lost', 'Denied'];

const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const hourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' });
const kuwaitDay = (d) => dayFmt.format(new Date(d));
const kuwaitHour = (d) => Number(hourFmt.format(new Date(d)));
/** the instant a Kuwait day starts ("2026-11-23" → 2026-11-22T21:00:00Z) */
const startOfKuwaitDay = (ymd) => new Date(`${ymd}T00:00:00+03:00`);
const addDays = (ymd, n) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const id = (x) => (x === null || x === undefined ? '' : String(x._id || x));
const ms = (d) => (d ? new Date(d).getTime() : NaN);
const isDate = (d) => d !== null && d !== undefined && !Number.isNaN(ms(d));
const real = (m) => m.internal !== true;
const avg = (arr) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0);
const initials = (name = '') =>
  String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase() || '?';

const windowOf = (range, now) => {
  let back = 0;
  if (range === '7d') back = 6;
  else if (range === '30d') back = 29;
  const today = kuwaitDay(now);
  return { start: startOfKuwaitDay(addDays(today, -back)), end: new Date(now) };
};
const trendDays = (now) => {
  const today = kuwaitDay(now);
  return Array.from({ length: TREND_DAYS }, (_, i) => addDays(today, i - (TREND_DAYS - 1)));
};

/** messages grouped by conversation, oldest first */
const byConversation = (messages) => {
  const map = new Map();
  messages.forEach((m) => {
    const k = id(m.conversation);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(m);
  });
  map.forEach((list) => list.sort((a, b) => ms(a.timestamp) - ms(b.timestamp)));
  return map;
};

/**
 * The waiting chats, from the MESSAGES (not the conversation's cached
 * `lastMessage`): not resolved, and the last real message is inbound.
 */
const waitingSet = (conversations, threads) => {
  const out = [];
  conversations.forEach((c) => {
    if (c.status === 'resolved') return;
    const list = (threads.get(id(c)) || []).filter(real);
    if (!list.length || list[list.length - 1].direction !== 'inbound') return;
    let i = list.length - 1;
    while (i > 0 && list[i - 1].direction === 'inbound') i -= 1;
    out.push({ conv: c, since: new Date(list[i].timestamp), unanswered: list.length - i });
  });
  return out.sort((a, b) => a.since - b.since);
};

const owners = (c) => Array.from(new Set((c.assignees || []).map((a) => a && a.userId && String(a.userId)).filter(Boolean)));

/** first-reply times in the window: every one, and per person who replied */
const replyTimes = (threads, start, end) => {
  const all = [];
  const byUser = {};
  threads.forEach((list) => {
    let pending = null;
    list
      .filter((m) => real(m) && ms(m.timestamp) >= start.getTime() && ms(m.timestamp) <= end.getTime())
      .forEach((m) => {
        if (m.direction === 'inbound') {
          if (pending === null) pending = ms(m.timestamp);
        } else if (m.direction === 'outbound' && pending !== null) {
          const sec = Math.max(0, Math.round((ms(m.timestamp) - pending) / 1000));
          all.push(sec);
          if (m.sentByUser) {
            const u = String(m.sentByUser);
            if (!byUser[u]) byUser[u] = [];
            byUser[u].push(sec);
          }
          pending = null;
        }
      });
  });
  return { all, byUser };
};

/**
 * @param {{conversations: object[], messages: object[], students: object[], users: object[]}} data
 * @param {'today'|'7d'|'30d'} range
 * @param {Date} now
 */
const recount = ({ conversations, messages, students = [], users = [] }, range, now = new Date()) => {
  const { start, end } = windowOf(range, now);
  const inWindow = (d) => isDate(d) && ms(d) >= start.getTime() && ms(d) <= end.getTime();
  const threads = byConversation(messages);
  const realInWindow = messages.filter((m) => real(m) && inWindow(m.timestamp));
  const sent = realInWindow.filter((m) => m.direction === 'outbound');
  const received = realInWindow.filter((m) => m.direction === 'inbound');
  const open = conversations.filter((c) => c.status !== 'resolved');
  const waitingAll = waitingSet(conversations, threads);
  const stageOf = new Map(students.map((s) => [id(s), s]));
  const nameOf = (c) => {
    const st = c.student ? stageOf.get(id(c.student)) : null;
    const studentName = st ? [st.firstName, st.lastName].filter(Boolean).join(' ') : '';
    return (c.contact && c.contact.name) || studentName || (c.contact && c.contact.phone);
  };

  // repeated inbound text
  const texts = new Map();
  messages
    .filter((m) => m.direction === 'inbound' && m.type === 'text' && inWindow(m.timestamp) && m.text)
    .forEach((m) => {
      const k = String(m.text).trim().toLowerCase();
      texts.set(k, (texts.get(k) || 0) + 1);
    });
  const repeated = Array.from(texts.values()).filter((n) => n > 1);

  const messagesByHour = Array.from({ length: 24 }, (_, hour) => ({ hour, sent: 0, received: 0 }));
  realInWindow.forEach((m) => {
    const b = messagesByHour[kuwaitHour(m.timestamp)];
    if (m.direction === 'outbound') b.sent += 1;
    else if (m.direction === 'inbound') b.received += 1;
  });

  // funnel: each student who has a chat, once, by stage
  const linked = new Set(conversations.filter((c) => c.student).map((c) => id(c.student)));
  const funnel = STAGES.map((key) => ({
    key,
    count: Array.from(linked).filter((sid) => stageOf.get(sid) && stageOf.get(sid).stage === key).length,
  }));

  const days = trendDays(now);
  const dayStart = startOfKuwaitDay(days[0]).getTime();
  const inTrend = (d) => isDate(d) && ms(d) >= dayStart && ms(d) <= end.getTime();
  const newConversationsTrend = days.map((date) => ({
    date,
    count: conversations.filter((c) => inTrend(c.createdAt) && kuwaitDay(c.createdAt) === date).length,
  }));
  const messagesPerDay = days.map((date) => {
    const of = messages.filter((m) => real(m) && inTrend(m.timestamp) && kuwaitDay(m.timestamp) === date);
    return {
      date,
      sent: of.filter((m) => m.direction === 'outbound').length,
      received: of.filter((m) => m.direction === 'inbound').length,
    };
  });

  const replies = replyTimes(threads, start, end);

  const overview = {
    range,
    kpis: {
      messagesTotal: realInWindow.length,
      messagesSent: sent.length,
      messagesReceived: received.length,
      voiceSent: sent.filter((m) => m.type === 'audio').length,
      voiceReceived: received.filter((m) => m.type === 'audio').length,
      unread: open.reduce((a, c) => a + (Number(c.unreadCount) || 0), 0),
      conversationsHandled: new Set(sent.map((m) => id(m.conversation))).size,
      newConversations: conversations.filter((c) => inWindow(c.createdAt)).length,
      waitingForReply: waitingAll.length,
      avgResponseSec: avg(replies.all),
      lateReplies: replies.all.filter((s) => s > SLA_SECONDS).length,
      repeatedQuestions: repeated.length,
      repeatedMessages: repeated.reduce((a, n) => a + n, 0),
      openConversations: open.length,
      unlinked: open.filter((c) => !c.student).length,
      followUpsOverdue: open.filter((c) => isDate(c.nextFollowUpAt) && ms(c.nextFollowUpAt) < end.getTime()).length,
      resolved: conversations.filter(
        (c) => c.status === 'resolved' && (isDate(c.resolvedAt) ? inWindow(c.resolvedAt) : inWindow(c.updatedAt))
      ).length,
      docsFiled: messages.filter((m) => m.savedDocument && m.savedDocument.id && inWindow(m.timestamp)).length,
      templatesSent: messages.filter((m) => m.direction === 'outbound' && m.type === 'template' && inWindow(m.timestamp))
        .length,
    },
    messagesByHour,
    messagesPerDay,
    funnel,
    waiting: waitingAll.slice(0, 8).map((w) => ({
      conversationId: id(w.conv),
      name: nameOf(w.conv),
      stage: w.conv.student && stageOf.get(id(w.conv.student)) ? stageOf.get(id(w.conv.student)).stage : undefined,
      assignee: owners(w.conv)[0] || null,
      unlinked: !w.conv.student,
      waitingSec: Math.max(0, Math.round((end.getTime() - w.since.getTime()) / 1000)),
      unanswered: w.unanswered,
    })),
    newConversationsTrend,
  };

  // ---- team ----
  const people = new Map();
  const row = (u) => {
    if (!people.has(u))
      people.set(u, { sent: 0, voice: 0, convs: new Set(), pending: 0, open: 0, overdue: 0, unlinked: 0, perDay: {} });
    return people.get(u);
  };
  sent
    .filter((m) => m.sentByUser)
    .forEach((m) => {
      const r = row(String(m.sentByUser));
      r.sent += 1;
      if (m.type === 'audio') r.voice += 1;
      r.convs.add(id(m.conversation));
    });
  waitingAll.forEach((w) =>
    owners(w.conv).forEach((u) => {
      row(u).pending += 1;
    })
  );
  open.forEach((c) =>
    owners(c).forEach((u) => {
      const r = row(u);
      r.open += 1;
      if (isDate(c.nextFollowUpAt) && ms(c.nextFollowUpAt) < end.getTime()) r.overdue += 1;
      if (!c.student) r.unlinked += 1;
    })
  );
  const perDayOf = {};
  messages
    .filter((m) => real(m) && m.direction === 'outbound' && m.sentByUser && inTrend(m.timestamp))
    .forEach((m) => {
      const u = String(m.sentByUser);
      if (!perDayOf[u]) perDayOf[u] = {};
      const d = kuwaitDay(m.timestamp);
      perDayOf[u][d] = (perDayOf[u][d] || 0) + 1;
    });
  const userOf = new Map(users.map((u) => [id(u), u]));
  const counselors = Array.from(people.entries()).map(([u, r]) => {
    const mine = replies.byUser[u] || [];
    const name = (userOf.get(u) && userOf.get(u).name) || 'Unknown';
    return {
      userId: u,
      name,
      initials: initials(userOf.get(u) && userOf.get(u).name),
      messagesSent: r.sent,
      voiceSent: r.voice,
      conversationsHandled: r.convs.size,
      pending: r.pending,
      openConversations: r.open,
      followUpsOverdue: r.overdue,
      unlinked: r.unlinked,
      avgResponseSec: avg(mine),
      lateReplies: mine.filter((s) => s > SLA_SECONDS).length,
      perDay: days.map((date) => ({ date, sent: (perDayOf[u] && perDayOf[u][date]) || 0 })),
    };
  });
  const team = {
    range,
    totals: {
      messagesSent: counselors.reduce((a, c) => a + c.messagesSent, 0),
      conversationsHandled: counselors.reduce((a, c) => a + c.conversationsHandled, 0),
      lateReplies: counselors.reduce((a, c) => a + c.lateReplies, 0),
      avgResponseSec: avg(replies.all),
    },
    counselors,
  };
  return { window: { start, end }, overview, team };
};

/**
 * Where the service's answer and the recount differ.
 * @returns {string[]} one line per difference; empty when they agree
 */
const compare = (service, expected) => {
  const diffs = [];
  const eq = (label, got, want) => {
    if (JSON.stringify(got) !== JSON.stringify(want))
      diffs.push(`${label}: dashboard ${JSON.stringify(got)} · records ${JSON.stringify(want)}`);
  };
  const o = service.overview;
  const eo = expected.overview;
  Object.keys(eo.kpis).forEach((k) => eq(`overview.kpis.${k}`, o.kpis[k], eo.kpis[k]));
  Object.keys(o.kpis)
    .filter((k) => !(k in eo.kpis))
    .forEach((k) => diffs.push(`overview.kpis.${k}: on the dashboard but not recounted`));
  eq('overview.messagesByHour', o.messagesByHour, eo.messagesByHour);
  eq('overview.messagesPerDay', o.messagesPerDay, eo.messagesPerDay);
  eq('overview.newConversationsTrend', o.newConversationsTrend, eo.newConversationsTrend);
  eq(
    'overview.funnel',
    o.funnel.map((f) => ({ key: f.key, count: f.count })),
    eo.funnel
  );
  // ties in the wait (two chats written in the same second) may list in either order
  const order = (list) =>
    list
      .map((w) => ({ ...w, name: w.name || null, stage: w.stage || null }))
      .sort((a, b) => b.waitingSec - a.waitingSec || a.conversationId.localeCompare(b.conversationId));
  eq('overview.waiting', order(o.waiting), order(eo.waiting));

  const t = service.team;
  const et = expected.team;
  eq('team.totals', t.totals, et.totals);
  const got = new Map(t.counselors.map((c) => [c.userId, c]));
  const want = new Map(et.counselors.map((c) => [c.userId, c]));
  Array.from(new Set([...got.keys(), ...want.keys()])).forEach((u) => {
    const g = got.get(u);
    const w = want.get(u);
    if (!g || !w) {
      diffs.push(`team.${u}: ${g ? 'on the dashboard but not in the records' : 'in the records but not on the dashboard'}`);
      return;
    }
    Object.keys(w).forEach((k) => eq(`team.${w.name}.${k}`, g[k], w[k]));
  });
  // ranked by chats handled, then messages sent
  t.counselors.forEach((c, i) => {
    const prev = t.counselors[i - 1];
    if (c.rank !== i + 1) diffs.push(`team.${c.name}.rank: ${c.rank} at position ${i + 1}`);
    if (
      prev &&
      (prev.conversationsHandled < c.conversationsHandled ||
        (prev.conversationsHandled === c.conversationsHandled && prev.messagesSent < c.messagesSent))
    )
      diffs.push(`team order: ${prev.name} is listed above ${c.name}`);
  });
  return diffs;
};

module.exports = { recount, compare, windowOf, kuwaitDay, kuwaitHour, waitingSet, byConversation, TZ };
