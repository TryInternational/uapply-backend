/* eslint-disable no-console, no-await-in-loop, no-restricted-syntax */
/**
 * Put right the chats whose cached "last message direction" disagrees with
 * their messages.
 *
 * Until now an internal note set the direction to "outbound", so a chat where
 * the student had written last — and staff had only added a note — dropped out
 * of the inbox's "Needs reply" chip and off the dashboard's waiting count. The
 * API no longer does that; this fixes the chats it already happened to.
 * (scripts/check-whatsapp-analytics.js lists them.)
 *
 * Only `lastMessage.direction` is changed, and only where the last real
 * message says otherwise. Nothing else is touched.
 *
 *   node scripts/repair-whatsapp-conversation-cache.js --env=staging
 *       dry run: lists the chats it would change
 *   node scripts/repair-whatsapp-conversation-cache.js --env=staging --confirm=<database name>
 *       changes them
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

async function main() {
  await mongoose.connect(config.mongoose.url, config.mongoose.options);
  const db = mongoose.connection;
  const write = !!args.confirm;
  if (write && args.confirm !== db.name) {
    console.error(`--confirm=${args.confirm} does not match the database "${db.name}". Nothing changed.`);
    await mongoose.disconnect();
    process.exit(1);
  }
  console.log(`${write ? 'Repairing' : 'Dry run against'} "${db.name}"`);
  const Conv = db.collection('whatsappconversations');
  const Msg = db.collection('whatsappmessages');

  // the last real (not internal) message of every chat
  const last = await Msg.aggregate(
    [
      { $match: { internal: { $ne: true } } },
      { $sort: { timestamp: 1 } },
      { $group: { _id: '$conversation', direction: { $last: '$direction' }, at: { $last: '$timestamp' } } },
    ],
    { allowDiskUse: true }
  ).toArray();
  const lastOf = new Map(last.map((r) => [String(r._id), r]));
  const convs = await Conv.find({}).project({ lastMessage: 1, status: 1, tags: 1 }).toArray();
  const wrong = convs.filter((c) => {
    const l = lastOf.get(String(c._id));
    return l && (!c.lastMessage || c.lastMessage.direction !== l.direction);
  });
  console.log(`${convs.length} chats, ${wrong.length} with a cached direction that disagrees with the last message`);
  for (const c of wrong) {
    const l = lastOf.get(String(c._id));
    console.log(
      `  ${c._id}  ${c.status || 'open'}  cached "${(c.lastMessage && c.lastMessage.direction) || '—'}" → ${l.direction}${
        l.direction === 'inbound' && c.status !== 'resolved' ? '  (the student is waiting)' : ''
      }`
    );
    if (write) await Conv.updateOne({ _id: c._id }, { $set: { 'lastMessage.direction': l.direction } });
  }
  if (wrong.length)
    console.log(write ? `\n${wrong.length} chat(s) repaired.` : '\nDry run — add --confirm=<database name> to change them.');
  await mongoose.disconnect();
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
