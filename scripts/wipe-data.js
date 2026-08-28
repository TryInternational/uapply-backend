/* eslint-disable no-console */
/**
 * Wipe the operational data and keep the setup.
 *
 * Empties: students, applications, documents, comments, notes, activities,
 * notifications. Leaves users, roles, courses, universities, subjects, SLA
 * settings and every other reference collection alone, so the app still works
 * and you can sign in afterwards.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * READ THIS BEFORE RUNNING IT
 *
 * In this repo `.env` and `.env.production` point at the SAME database:
 * `uapply` on cluster0.scgcs.gcp.mongodb.net. Only `.env.staging` is separate
 * (`upply_staging`), and that is the one `npm run dev` uses. So running this
 * without APP_ENV set does not target "local dev" — it targets the database
 * production uses.
 *
 * That is why nothing here is inferred. You pass the environment, and then you
 * type the database name back to confirm it. A wrong APP_ENV cannot slip
 * through, because the name you type has to match the database it connected to.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   node scripts/wipe-data.js --env=staging                      # counts only
 *   node scripts/wipe-data.js --env=staging --confirm=upply_staging   # deletes
 *
 * There is no undo. Take a backup first if the data matters:
 *   mongodump --uri "<your MONGODB_URL>" --out ./backup-$(date +%F)
 */
const path = require('path');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v === undefined ? true : v];
  })
);

if (!args.env) {
  console.error('Refusing to guess. Pass --env=staging (or the env file suffix you mean).');
  process.exit(1);
}
process.env.APP_ENV = args.env;
process.env.NODE_ENV = process.env.NODE_ENV || 'development';

// eslint-disable-next-line import/no-dynamic-require, global-require
const config = require(path.join(__dirname, '..', 'src', 'config', 'config'));
const mongoose = require('mongoose');

// Exactly the seven the request named. Anything not on this list is untouched.
const TARGETS = [
  'students',
  'applications',
  'documents',
  'comments',
  'notes',
  'activities',
  'notifications',
];

// Collections that reference the above and will be left holding dangling ids.
// Not deleted — widening the blast radius on my own initiative would be worse
// than reporting it — but you should know they are there.
const REFERENCERS = [
  'appliedstudents',
  'leads',
  'fees',
  'bookings',
  'payments',
  'reminders',
  'accessrequests',
  'whatsappconversations',
  'whatsappmessages',
  'ulearnstudents',
];

(async () => {
  await mongoose.connect(config.mongoose.url, config.mongoose.options || {});
  const { connection } = mongoose;
  const dbName = connection.name;
  const present = (await connection.db.listCollections().toArray()).map((c) => c.name);

  console.log(`\nconnected to: ${dbName}  (APP_ENV=${args.env})\n`);

  let total = 0;
  const counts = {};
  for (const name of TARGETS) {
    // eslint-disable-next-line no-await-in-loop
    counts[name] = present.includes(name) ? await connection.collection(name).countDocuments() : null;
    if (counts[name]) total += counts[name];
    console.log(
      `  ${name.padEnd(14)} ${counts[name] === null ? '— not present' : String(counts[name]).padStart(7)}`
    );
  }
  console.log(`  ${''.padEnd(14)} ${String(total).padStart(7)}  TOTAL\n`);

  const stillReferencing = [];
  for (const name of REFERENCERS) {
    if (!present.includes(name)) continue;
    // eslint-disable-next-line no-await-in-loop
    const n = await connection.collection(name).countDocuments();
    if (n) stillReferencing.push(`${name} (${n})`);
  }
  if (stillReferencing.length) {
    console.log('These reference the wiped records and are NOT touched:');
    console.log(`  ${stillReferencing.join(', ')}\n`);
  }

  if (!args.confirm) {
    console.log('Nothing deleted — this was a count.');
    console.log(`To delete, re-run with:  --env=${args.env} --confirm=${dbName}\n`);
    await mongoose.disconnect();
    return;
  }

  // The typed name must match the database actually connected to. This is the
  // check that catches a wrong --env: you cannot confirm a database you did not
  // mean to be looking at.
  if (args.confirm !== dbName) {
    console.error(`Refusing: you confirmed "${args.confirm}" but this is "${dbName}".`);
    console.error('If that surprises you, check which env file APP_ENV picked up.\n');
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log('deleting…\n');
  for (const name of TARGETS) {
    if (!present.includes(name)) continue;
    // eslint-disable-next-line no-await-in-loop
    const res = await connection.collection(name).deleteMany({});
    console.log(`  ${name.padEnd(14)} ${String(res.deletedCount).padStart(7)} deleted`);
  }

  console.log('\nDone. Users, roles, courses, universities and settings are untouched.');
  console.log('Uploaded files still sit in Firebase Storage — the document ROWS are gone,');
  console.log('so those blobs are now unreferenced and have to be cleared there separately.\n');
  await mongoose.disconnect();
})().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
