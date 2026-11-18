/* eslint-disable no-console, no-await-in-loop, no-restricted-syntax, security/detect-non-literal-fs-filename */
/**
 * Remove the demo data left by the sub-agent portal end-to-end test.
 *
 * The test ran through the portal as a real sub-agent, and a sub-agent cannot
 * delete a student (only "remove" one, which keeps the record) — so the demo
 * students, and everything hanging off them, are removed here instead.
 *
 * WHAT COUNTS AS DEMO DATA
 * Students whose first name starts with the marker E2E_SUBAGENT_TEST_2026.
 * Nothing else is matched: not by email, not by agent, not by date.
 *
 *   node scripts/cleanup-e2e-subagent-test.js
 *       dry run: lists the students and how many documents, comments,
 *       activities, notifications, applications, notes and reminders belong to
 *       them, and the storage files those documents point at. Writes nothing.
 *   node scripts/cleanup-e2e-subagent-test.js --confirm=<staging db name>
 *       deletes exactly what the dry run listed, then re-counts to show that
 *       nothing is left.
 *
 * The uploaded files themselves live in Firebase Storage and were written from
 * the browser; this script cannot delete them. It prints their paths so they
 * can be removed in the Firebase console (they are a few KB each and nothing
 * references them once the documents are gone).
 */
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const mongoose = require('mongoose');

const MARKER = 'E2E_SUBAGENT_TEST_2026';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.length ? v.join('=') : true];
  })
);
const root = path.join(__dirname, '..');

const stagingUrl = () => {
  const file = path.join(root, '.env.staging');
  if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);
  const url = dotenv.parse(fs.readFileSync(file)).MONGODB_URL;
  if (!url) throw new Error('MONGODB_URL is not set in .env.staging');
  return url;
};

// collection → the field that points at the student
const LINKED = [
  ['documents', 'studentId'],
  ['comments', 'studentId'],
  ['activities', 'student'],
  ['notifications', 'studentId'],
  ['applications', 'studentId'],
  ['notes', 'student'],
  ['reminders', 'student'],
];

const main = async () => {
  const confirm = typeof args.confirm === 'string' ? args.confirm : '';
  await mongoose.connect(stagingUrl());
  const { db } = mongoose.connection;
  const dbName = db.databaseName;
  console.log(`Connected to ${dbName}`);
  if (/prod/i.test(dbName)) throw new Error(`Refusing to run against "${dbName}" — this script is for staging.`);
  if (confirm && confirm !== dbName)
    throw new Error(`--confirm=${confirm} does not match the connected database "${dbName}".`);

  const existing = new Set((await db.listCollections().toArray()).map((c) => c.name));
  const students = await db
    .collection('students')
    .find({ firstName: { $regex: `^${MARKER}` } })
    .project({ firstName: 1, lastName: 1, stage: 1, createdAt: 1, email: 1 })
    .toArray();

  if (!students.length) {
    console.log(`No students whose first name starts with ${MARKER}. Nothing to do.`);
    return;
  }
  const ids = students.map((s) => s._id);
  console.log(`\n${students.length} demo student(s):`);
  students.forEach((s) => console.log(`  ${s._id}  ${s.firstName} ${s.lastName}  [${s.stage}]  ${s.email || 'no email'}`));

  const count = async () => {
    const out = {};
    for (const [name, field] of LINKED) {
      out[name] = existing.has(name) ? await db.collection(name).countDocuments({ [field]: { $in: ids } }) : 0;
    }
    return out;
  };
  const before = await count();
  console.log('\nRecords that belong to them:');
  Object.entries(before).forEach(([k, n]) => console.log(`  ${k.padEnd(14)} ${n}`));

  const files = [];
  if (existing.has('documents')) {
    const docs = await db
      .collection('documents')
      .find({ studentId: { $in: ids } })
      .project({ blobInfo: 1 })
      .toArray();
    docs.forEach((d) => (d.blobInfo || []).forEach((b) => files.push(b.blobUrl || b.url)));
  }
  // comment attachments, if any
  if (existing.has('comments')) {
    const cs = await db
      .collection('comments')
      .find({ studentId: { $in: ids } })
      .project({ images: 1 })
      .toArray();
    cs.forEach((c) => (c.images || []).forEach((u) => files.push(typeof u === 'string' ? u : u && u.url)));
  }
  const storagePaths = files.filter(Boolean).map((u) => {
    try {
      const m = /\/o\/([^?]+)/.exec(u);
      return m ? decodeURIComponent(m[1]) : u;
    } catch (e) {
      return u;
    }
  });
  console.log(`\nStorage files (${storagePaths.length}) — remove these in the Firebase console:`);
  storagePaths.forEach((p) => console.log(`  ${p}`));

  if (!confirm) {
    console.log(`\nDry run — nothing was deleted. To delete, run again with --confirm=${dbName}`);
    return;
  }

  for (const [name, field] of LINKED) {
    if (existing.has(name)) {
      const r = await db.collection(name).deleteMany({ [field]: { $in: ids } });
      console.log(`deleted ${String(r.deletedCount).padStart(3)} from ${name}`);
    }
  }
  const r = await db.collection('students').deleteMany({ _id: { $in: ids }, firstName: { $regex: `^${MARKER}` } });
  console.log(`deleted ${String(r.deletedCount).padStart(3)} from students`);

  const after = await count();
  const left =
    (await db.collection('students').countDocuments({ firstName: { $regex: `^${MARKER}` } })) +
    Object.values(after).reduce((a, b) => a + b, 0);
  console.log(
    left === 0
      ? '\nVerified: no demo records remain in the database.'
      : `\nWARNING: ${left} record(s) still match — re-run the dry run to see them.`
  );
};

main()
  .catch((err) => {
    console.error(err.message || err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
