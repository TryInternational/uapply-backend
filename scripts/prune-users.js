/* eslint-disable no-console */
/**
 * Delete every user except one admin.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * READ BEFORE RUNNING
 *
 * There is no undo, and getting the keeper wrong locks you out of your own
 * back office. So nothing here is inferred:
 *
 *   • You name the account to keep, by email.
 *   • The script refuses if that account does not exist.
 *   • The script refuses if that account is not an ADMIN — deleting everyone
 *     and keeping a counsellor would leave nobody who can create users.
 *   • You type the database name back to confirm, and it must match the
 *     database actually connected to.
 *
 * Take a backup first if any of this matters:
 *   mongodump --uri "<your MONGODB_URL>" --out ./backup-$(date +%F)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   node scripts/prune-users.js --env=staging --keep=you@try.city
 *   node scripts/prune-users.js --env=staging --keep=you@try.city --confirm=upply_staging
 *
 * Deletes the users and their auth tokens. It does NOT delete the records
 * those users created or were assigned to — it reports them instead, because
 * cascading from a user to their students is a much bigger decision than this
 * script should make on its own.
 */
const path = require('path');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v === undefined ? true : v];
  })
);

if (!args.env) {
  console.error('Refusing to guess which database. Pass --env=staging');
  process.exit(1);
}
if (!args.keep || args.keep === true) {
  console.error('Pass --keep=<email> — the one account to survive. It must be an admin.');
  process.exit(1);
}
process.env.APP_ENV = args.env;
process.env.NODE_ENV = process.env.NODE_ENV || 'development';

// eslint-disable-next-line import/no-dynamic-require
const config = require(path.join(__dirname, '..', 'src', 'config', 'config'));
const mongoose = require('mongoose');
// eslint-disable-next-line import/no-dynamic-require
const { ADMIN_RIGHT } = require(path.join(__dirname, '..', 'src', 'services', 'roleAccess.service'));

const KEEP = String(args.keep).trim().toLowerCase();

// Collections that point at a user, and the fields that do. Reported, never
// deleted — see the note at the top.
const REFERENCES = [
  ['students', ['createdBy', 'assignedTo.user', 'sharedWithCounselors.user']],
  ['applications', ['createdBy']],
  ['comments', ['userId']],
  ['notes', ['createdBy']],
  ['activities', ['actorId']],
  ['notifications', ['createdBy']],
  ['reminders', ['createdBy']],
  ['accessrequests', ['user', 'decision.by']],
  ['whatsappconversations', ['assignees']],
  ['whatsappmessages', ['sentBy']],
  ['appliedstudents', ['createdBy']],
  ['bookings', ['createdBy']],
];

(async () => {
  await mongoose.connect(config.mongoose.url, config.mongoose.options || {});
  const db = mongoose.connection;
  const dbName = db.name;
  console.log(`\nconnected to: ${dbName}   (APP_ENV=${args.env})\n`);

  const roles = await db.collection('roles').find({}).toArray();
  const roleById = new Map(roles.map((r) => [String(r._id), r]));
  const adminRoleIds = roles.filter((r) => (r.roleRights || []).includes(ADMIN_RIGHT)).map((r) => String(r._id));

  const users = await db.collection('users').find({}).project({ name: 1, email: 1, role: 1 }).toArray();
  const keeper = users.find((u) => String(u.email || '').toLowerCase() === KEEP);

  if (!keeper) {
    console.error(`No user with email "${KEEP}". Nothing was deleted.\n`);
    console.error('Accounts that exist:');
    users.forEach((u) => console.error(`  ${u.email}`));
    await mongoose.disconnect();
    process.exit(1);
  }

  const keeperRole = roleById.get(String(keeper.role));
  const keeperIsAdmin = adminRoleIds.includes(String(keeper.role));
  console.log(`keeping:  ${keeper.email}   role: ${keeperRole ? keeperRole.name : '(none)'}`);

  if (!keeperIsAdmin) {
    console.error(`\nRefusing: "${keeper.email}" is not an admin, so deleting everyone else would leave`);
    console.error('nobody able to administer the system. Roles carrying admin right now:');
    if (!adminRoleIds.length) {
      console.error('  (none — run migrations/roleRights.migration.js first)');
    } else {
      adminRoleIds.forEach((id) => console.error(`  ${roleById.get(id).name}`));
    }
    console.error('');
    await mongoose.disconnect();
    process.exit(1);
  }

  const doomed = users.filter((u) => String(u._id) !== String(keeper._id));
  console.log(`deleting: ${doomed.length} of ${users.length} account(s)\n`);
  doomed.forEach((u) => {
    const r = roleById.get(String(u.role));
    console.log(`  ${String(u.email || '(no email)').padEnd(38)} ${r ? r.name : '(no role)'}`);
  });

  // What will be left pointing at a deleted account.
  const doomedIds = doomed.map((u) => u._id);
  const dangling = [];
  // listCollections lives on the driver handle, not on the mongoose connection.
  const present = (await db.db.listCollections().toArray()).map((c) => c.name);
  for (const [name, fields] of REFERENCES) {
    if (!present.includes(name)) continue;
    for (const field of fields) {
      // eslint-disable-next-line no-await-in-loop
      const n = await db.collection(name).countDocuments({ [field]: { $in: doomedIds } });
      if (n) dangling.push(`${name}.${field} (${n})`);
    }
  }
  if (dangling.length) {
    console.log('\nRecords that will point at a deleted account — NOT touched:');
    dangling.forEach((d) => console.log(`  ${d}`));
  }

  if (!args.confirm) {
    console.log(`\nNothing deleted — this was a dry run.`);
    console.log(`To delete, re-run with:  --env=${args.env} --keep=${KEEP} --confirm=${dbName}\n`);
    await mongoose.disconnect();
    return;
  }
  if (args.confirm !== dbName) {
    console.error(`\nRefusing: you confirmed "${args.confirm}" but this is "${dbName}".\n`);
    await mongoose.disconnect();
    process.exit(1);
  }

  const res = await db.collection('users').deleteMany({ _id: { $in: doomedIds } });
  console.log(`\n  users   ${String(res.deletedCount).padStart(5)} deleted`);

  // Their sessions go too. A deleted user's access token stays cryptographically
  // valid until it expires; passport rejects it because the user lookup fails,
  // but leaving the rows behind serves no purpose.
  if (present.includes('tokens')) {
    const t = await db.collection('tokens').deleteMany({ user: { $in: doomedIds } });
    console.log(`  tokens  ${String(t.deletedCount).padStart(5)} deleted`);
  }

  const left = await db.collection('users').countDocuments();
  console.log(`\n${left} account remains: ${keeper.email}\n`);
  await mongoose.disconnect();
})().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
