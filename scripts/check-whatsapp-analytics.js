/* eslint-disable no-console, no-await-in-loop, no-restricted-syntax */
/**
 * Do the WhatsApp dashboards say what the database says?
 *
 * Reads every WhatsApp conversation and message (read-only), recounts each
 * dashboard figure from those records in plain code (scripts/lib/whatsappRecount.js),
 * asks the API's own analytics service for the same figures at the same
 * instant, and prints every figure where the two differ — for Today, 7 days
 * and 30 days.
 *
 *   node scripts/check-whatsapp-analytics.js --env=staging
 *   node scripts/check-whatsapp-analytics.js --env=staging --demo-only
 *       the same, counting only the chats tagged "demo" (what the seed wrote)
 *
 * It also checks that each chat's cached fields agree with its messages (the
 * inbox reads those): the direction of the last message, and an unread count
 * no larger than what the student has sent since the last reply.
 *
 * Exit code 0 when everything agrees, 1 when anything differs. Writes nothing.
 */
const path = require('path');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.length ? v.join('=') : true];
  })
);
if (!args.env) {
  console.error('Say which environment: --env=staging');
  process.exit(1);
}
process.env.APP_ENV = args.env;
process.env.NODE_ENV = process.env.NODE_ENV || 'development';

const mongoose = require('mongoose');
// eslint-disable-next-line import/no-dynamic-require
const config = require(path.join(__dirname, '..', 'src', 'config', 'config'));
const { recount, compare, byConversation } = require('./lib/whatsappRecount');

const RANGES = ['today', '7d', '30d'];

/** each chat's cached fields against its own messages */
const cacheProblems = (conversations, messages) => {
  const threads = byConversation(messages);
  const out = [];
  conversations.forEach((c) => {
    const real = (threads.get(String(c._id)) || []).filter((m) => m.internal !== true);
    if (!real.length) return;
    const last = real[real.length - 1];
    const cached = c.lastMessage && c.lastMessage.direction;
    if (cached !== last.direction)
      out.push(`chat ${c._id}: cached last direction "${cached}" but the last message is ${last.direction}`);
    let trailing = 0;
    for (let i = real.length - 1; i >= 0 && real[i].direction === 'inbound'; i -= 1) trailing += 1;
    if ((c.unreadCount || 0) > trailing)
      out.push(`chat ${c._id}: unread ${c.unreadCount} but only ${trailing} message(s) since the last reply`);
  });
  return out;
};

async function main() {
  await mongoose.connect(config.mongoose.url, config.mongoose.options);
  const db = mongoose.connection;
  console.log(`Reading "${db.name}" (${args.env}) — nothing is written`);
  // the API's own service, on this connection
  // eslint-disable-next-line global-require
  const analytics = require('../src/services/whatsappAnalytics.services');

  const convFilter = args['demo-only'] ? { tags: 'demo' } : {};
  const conversations = await db.collection('whatsappconversations').find(convFilter).toArray();
  const ids = conversations.map((c) => c._id);
  const messages = await db
    .collection('whatsappmessages')
    .find(args['demo-only'] ? { conversation: { $in: ids } } : {})
    .project({ 'media.url': 0 })
    .toArray();
  const studentIds = conversations.map((c) => c.student).filter(Boolean);
  const students = await db
    .collection('students')
    .find({ _id: { $in: studentIds } })
    .project({ firstName: 1, lastName: 1, stage: 1 })
    .toArray();
  const users = await db.collection('users').find({}).project({ name: 1 }).toArray();
  console.log(
    `${conversations.length} chats (${conversations.filter((c) => (c.tags || []).includes('demo')).length} demo), ${
      messages.length
    } message rows, ${students.length} linked students`
  );

  let failed = 0;
  const cache = cacheProblems(conversations, messages);
  if (cache.length) {
    failed += cache.length;
    console.log(`\n✗ ${cache.length} chat(s) whose cached fields disagree with their messages:`);
    cache.slice(0, 20).forEach((l) => console.log(`    ${l}`));
    if (cache.length > 20) console.log(`    … and ${cache.length - 20} more`);
  } else console.log("\n✓ every chat's cached last message and unread count agree with its messages");

  if (args['demo-only']) {
    console.log('\n--demo-only: the dashboard counts every chat, so only the recount is printed.');
    for (const range of RANGES) {
      const r = recount({ conversations, messages, students, users }, range, new Date());
      console.log(`  ${range.padEnd(6)} ${JSON.stringify(r.overview.kpis)}`);
    }
  } else {
    for (const range of RANGES) {
      const now = new Date();
      const [overview, team] = await Promise.all([analytics.overview(range, now), analytics.team(range, now)]);
      const expected = recount({ conversations, messages, students, users }, range, now);
      const diffs = compare({ overview, team }, expected);
      const k = overview.kpis;
      console.log(
        `\n${range}  (${overview.window.start} → ${overview.window.end})\n` +
          `  messages ${k.messagesSent} sent · ${k.messagesReceived} received · chats handled ${k.conversationsHandled} · new ${k.newConversations} · resolved ${k.resolved}\n` +
          `  waiting ${k.waitingForReply} · open ${k.openConversations} · unread ${k.unread} · first reply ${k.avgResponseSec}s · late ${k.lateReplies} · team rows ${team.counselors.length}`
      );
      if (diffs.length) {
        failed += diffs.length;
        console.log(`  ✗ ${diffs.length} figure(s) differ from the records:`);
        diffs.slice(0, 30).forEach((d) => console.log(`      ${d.length > 300 ? `${d.slice(0, 300)}…` : d}`));
      } else console.log('  ✓ every figure matches the records');
    }
  }

  await mongoose.disconnect();
  console.log(failed ? `\n${failed} difference(s).` : '\nAll figures match.');
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e.message || e);
  try {
    await mongoose.disconnect();
  } catch (_) {
    /* ignore */
  }
  process.exit(1);
});
