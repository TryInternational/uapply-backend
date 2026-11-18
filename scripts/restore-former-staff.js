/* eslint-disable no-console, no-await-in-loop, no-restricted-syntax, no-continue, security/detect-non-literal-fs-filename */
/**
 * Bring back deleted staff as CLOSED ("former") accounts, under their original
 * ids, so the fees and students that still point at those ids show a name
 * again instead of "Former staff" / "Unknown".
 *
 * Nothing is read from production. The script only touches the database named
 * by --confirm.
 *
 *   node scripts/restore-former-staff.js
 *       dry run: for each person, how many fees / students reference the id,
 *       whether a user with that id already exists, and which role would be
 *       used. Writes nothing.
 *   ... --confirm=<staging db name>
 *       inserts the missing users (former: true) and writes a manifest.
 *   ... --rollback=<manifest> --confirm=<staging db name>
 *       removes exactly the users that run added.
 *
 * Who is restored — the two ids the fees migration found with no user behind
 * them (built in), plus anyone given as
 *   --add="<id>|<name>|<role name>;<id>|<name>|<role name>"
 * The role is matched by name against the roles collection, case-insensitive,
 * substring is fine ("operation" matches "Operations").
 *
 * Users are written with the raw driver (the model's save hook would hash the
 * placeholder password a second time). They get a random password nobody
 * knows and a placeholder address at former.ulearn.local; both are moot while
 * the account is closed, and valid enough that reopening it later saves fine.
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const { ObjectId } = mongoose.Types;

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.length ? v.join('=') : true];
  })
);
const root = path.join(__dirname, '..');
const OUT_DIR = path.join(root, 'node_modules', '.cache', 'claude', 'former-staff');

const stagingUrl = () => {
  const file = path.join(root, '.env.staging');
  if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);
  const url = dotenv.parse(fs.readFileSync(file)).MONGODB_URL;
  if (!url) throw new Error('MONGODB_URL is not set in .env.staging');
  return url;
};

// The two ids left behind by deleted production accounts (see the fees
// migration report). Kruthika handled visas and IELTS (99 fees as incharge);
// the second was a sales account whose name no record kept — sales people
// carry the Counselor role in this CRM.
const BUILT_IN = [
  { id: '6784ae0aebf200001cad436c', name: 'Kruthika', role: 'operation' },
  { id: '682993e62a3e164e7a2f09a6', name: 'Former sales staff', role: 'counselor' },
];

const parseAdd = (s) =>
  String(s || '')
    .split(';')
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => {
      const [id, name, role] = x.split('|').map((y) => (y || '').trim());
      if (!ObjectId.isValid(id) || !name || !role) throw new Error(`--add entry not understood: "${x}" (want id|name|role)`);
      return { id, name, role };
    });

const slug = (s) =>
  String(s)
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '.')
    .replace(/^\.+|\.+$/g, '') || 'former';

const STAFF_SLOTS = ['salesPerson', 'incharge', 'checkedBy', 'accountManager', 'operation'];

/** How many fees point at this id in any staff slot (as an id string, or as a user object). */
const feeRefs = async (db, id) => {
  const or = [];
  for (const slot of STAFF_SLOTS) {
    or.push({ [`tag.${slot}`]: id });
    or.push({ [`tag.${slot}.id`]: id });
    or.push({ [`tag.${slot}._id`]: id });
    or.push({ [`tag.${slot}._id`]: new ObjectId(id) });
  }
  const bySlot = {};
  for (const slot of STAFF_SLOTS) {
    const n = await db.collection('fees').countDocuments({
      $or: [
        { [`tag.${slot}`]: id },
        { [`tag.${slot}.id`]: id },
        { [`tag.${slot}._id`]: id },
        { [`tag.${slot}._id`]: new ObjectId(id) },
      ],
    });
    if (n) bySlot[slot] = n;
  }
  const total = await db.collection('fees').countDocuments({ $or: or });
  return { total, bySlot };
};

const studentRefs = async (db, id) =>
  db.collection('students').countDocuments({
    $or: [
      { 'assignedTo.user': id },
      { 'assignedTo.user': new ObjectId(id) },
      { createdBy: id },
      { createdBy: new ObjectId(id) },
    ],
  });

const main = async () => {
  const confirm = typeof args.confirm === 'string' ? args.confirm : '';
  const url = stagingUrl();
  await mongoose.connect(url);
  const { db } = mongoose.connection;
  const dbName = db.databaseName;
  console.log(`Connected to ${dbName}`);
  if (/prod/i.test(dbName)) throw new Error(`Refusing to run against "${dbName}" — this script is for staging.`);
  if (confirm && confirm !== dbName)
    throw new Error(`--confirm=${confirm} does not match the connected database "${dbName}"`);

  // ---------------------------------------------------------------- rollback
  if (args.rollback) {
    if (!confirm) throw new Error('--rollback needs --confirm=<db name>');
    const manifest = JSON.parse(fs.readFileSync(path.resolve(String(args.rollback)), 'utf8'));
    if (manifest.db !== dbName) throw new Error(`Manifest is for "${manifest.db}", connected to "${dbName}"`);
    const ids = (manifest.inserted || []).map((x) => new ObjectId(x.id));
    const r = await db.collection('users').deleteMany({ _id: { $in: ids }, former: true });
    console.log(`Removed ${r.deletedCount} of ${ids.length} users added by that run.`);
    await mongoose.disconnect();
    return;
  }

  // ---------------------------------------------------------------- roles
  const roles = await db.collection('roles').find({}).project({ name: 1 }).toArray();
  console.log(`Roles: ${roles.map((r) => `${r.name} (${r._id})`).join(', ')}`);
  const roleFor = (want) => {
    const w = String(want).toLowerCase();
    const exact = roles.find((r) => String(r.name).toLowerCase() === w);
    if (exact) return exact;
    const partial = roles.filter((r) => String(r.name).toLowerCase().includes(w));
    if (partial.length === 1) return partial[0];
    if (partial.length > 1) throw new Error(`Role "${want}" matches several: ${partial.map((r) => r.name).join(', ')}`);
    return null;
  };

  const people = [...BUILT_IN, ...parseAdd(args.add)];
  const plan = [];
  for (const p of people) {
    const _id = new ObjectId(p.id);
    const existing = await db.collection('users').findOne({ _id }, { projection: { name: 1, former: 1 } });
    const fees = await feeRefs(db, p.id);
    const students = await studentRefs(db, p.id);
    const role = roleFor(p.role);
    plan.push({ ...p, existing, fees, students, roleDoc: role });
  }

  console.log('');
  for (const p of plan) {
    const refs = `${p.fees.total} fee${p.fees.total === 1 ? '' : 's'}${
      Object.keys(p.fees.bySlot).length
        ? ` (${Object.entries(p.fees.bySlot)
            .map(([k, v]) => `${k} ${v}`)
            .join(', ')})`
        : ''
    }, ${p.students} student${p.students === 1 ? '' : 's'}`;
    if (p.existing) {
      console.log(`SKIP  ${p.id}  already a user: "${p.existing.name}"${p.existing.former ? ' (former)' : ''} — ${refs}`);
    } else if (!p.roleDoc) {
      console.log(`SKIP  ${p.id}  "${p.name}" — no role matches "${p.role}" — ${refs}`);
    } else {
      console.log(`ADD   ${p.id}  "${p.name}" as ${p.roleDoc.name}, former — ${refs}`);
    }
  }

  const toAdd = plan.filter((p) => !p.existing && p.roleDoc);
  if (!confirm) {
    console.log(`\nDry run — ${toAdd.length} to add. Re-run with --confirm=${dbName} to write.`);
    await mongoose.disconnect();
    return;
  }
  if (!toAdd.length) {
    console.log('\nNothing to add.');
    await mongoose.disconnect();
    return;
  }

  const now = new Date();
  const inserted = [];
  for (const p of toAdd) {
    const email = `${slug(p.name)}.${p.id.slice(-6)}@former.ulearn.local`;
    const doc = {
      _id: new ObjectId(p.id),
      name: p.name,
      email,
      password: await bcrypt.hash(crypto.randomBytes(24).toString('base64url'), 8),
      role: p.roleDoc._id,
      former: true,
      formerAt: now,
      createdAt: now,
      updatedAt: now,
    };
    await db.collection('users').insertOne(doc);
    inserted.push({ id: p.id, name: p.name, email, role: p.roleDoc.name });
    console.log(`added ${p.name} (${email})`);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const manifestPath = path.join(OUT_DIR, `manifest-${stamp}.json`);
  fs.writeFileSync(manifestPath, JSON.stringify({ db: dbName, at: now.toISOString(), inserted }, null, 2));
  console.log(`\nRESTORED ${inserted.length}. Manifest: ${manifestPath}`);
  console.log('Reload the dashboard — the ids resolve to "Name (former)" now.');
  await mongoose.disconnect();
};

main().catch(async (err) => {
  console.error(err.message || err);
  try {
    await mongoose.disconnect();
  } catch (_) {
    /* already closed */
  }
  process.exit(1);
});
