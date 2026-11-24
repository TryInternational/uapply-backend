const { WhatsappMessage } = require('../models');

/**
 * "The student is waiting" — one definition for the inbox, the counsellor's
 * card and the admin dashboard.
 *
 * A chat is waiting when it is not resolved and its last real message is the
 * student's (`lastMessage.direction === 'inbound'`; an internal note does not
 * change the direction). HOW LONG they have waited runs from the FIRST message
 * of theirs that has had no answer, not from their latest one: a student who
 * wrote at 9:00 and again at 11:00 has been waiting since 9:00.
 */

/** The Mongo filter for the chats that are waiting. */
const WAITING_FILTER = { 'lastMessage.direction': 'inbound', status: { $ne: 'resolved' } };

const isWaiting = (conv) =>
  !!conv && conv.status !== 'resolved' && !!conv.lastMessage && conv.lastMessage.direction === 'inbound';

const OR_CHUNK = 200;

/**
 * For each of the given (waiting) chats: when the wait began and how many
 * messages the student has sent since the last reply.
 * @param {Array<{_id}>} convs
 * @returns {Promise<Map<string, {since: Date, unanswered: number}>>} keyed by conversation id;
 *   a chat with no message rows is absent
 */
const firstUnanswered = async (convs) => {
  const out = new Map();
  if (!convs || !convs.length) return out;
  const ids = convs.map((c) => c._id);
  const lastOut = await WhatsappMessage.aggregate([
    { $match: { conversation: { $in: ids }, direction: 'outbound', internal: { $ne: true } } },
    { $group: { _id: '$conversation', at: { $max: '$timestamp' } } },
  ]);
  const lastOutAt = new Map(lastOut.map((r) => [String(r._id), r.at]));
  // everything a waiting chat holds after its last reply is the student's
  const clauses = convs.map((c) => {
    const at = lastOutAt.get(String(c._id));
    return at
      ? { conversation: c._id, direction: 'inbound', timestamp: { $gt: at } }
      : { conversation: c._id, direction: 'inbound' };
  });
  const chunks = [];
  for (let i = 0; i < clauses.length; i += OR_CHUNK) chunks.push(clauses.slice(i, i + OR_CHUNK));
  const parts = await Promise.all(
    chunks.map((or) =>
      WhatsappMessage.aggregate([
        { $match: { $or: or } },
        { $group: { _id: '$conversation', since: { $min: '$timestamp' }, n: { $sum: 1 } } },
      ])
    )
  );
  parts.forEach((rows) => rows.forEach((r) => out.set(String(r._id), { since: r.since, unanswered: r.n })));
  return out;
};

/**
 * Stamp `waitingSince` / `unanswered` on the waiting chats of a list, in
 * place (two queries for the whole list). A waiting chat with no message rows
 * falls back to `lastMessageAt`.
 */
/* eslint-disable no-param-reassign */
const attachWaitingSince = async (convs) => {
  const list = (Array.isArray(convs) ? convs : [convs]).filter(isWaiting);
  if (!list.length) return;
  const open = await firstUnanswered(list);
  list.forEach((c) => {
    const o = open.get(String(c._id));
    c.waitingSince = (o && o.since) || c.lastMessageAt || null;
    c.unanswered = o ? o.unanswered : 0;
  });
};
/* eslint-enable no-param-reassign */

module.exports = { WAITING_FILTER, isWaiting, firstUnanswered, attachWaitingSince };
