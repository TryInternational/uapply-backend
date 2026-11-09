/* eslint-disable no-console, no-await-in-loop, no-restricted-syntax, no-continue, security/detect-non-literal-fs-filename */
/**
 * Copy staff accounts that exist in PRODUCTION but not in STAGING into staging,
 * so the people on the imported Trello cards can log in to staging and see
 * their own students.
 *
 * Production is only READ (one find on users, one on roles). Nothing is
 * written there.
 *
 *   node scripts/copy-users-from-production.js --people="<people-to-match.csv>"
 *       dry run: lists production users missing from staging and which Trello
 *       name each one matches. Writes nothing.
 *   ... --confirm=<staging db name>
 *       copies the users that match a Trello name (add --all to copy every
 *       missing staff user instead; --skip=email1,email2 leaves out a wrong
 *       match), and writes a CSV of the matches next to
 *       the people file plus a manifest for undo.
 *   ... --rollback=<manifest> --confirm=<staging db name>
 *       removes exactly the users that run added.
 *
 * What is copied: name, email, role (mapped to the staging role OF THE SAME
 * NAME), avatar, organisation, the password HASH (so people sign in with the
 * password they already use) and the same _id as production, which keeps
 * references lined up when the data later moves to production.
 * What is NOT copied: slackMemberId — staging must never DM anyone on Slack
 * when one of them is @mentioned in a comment.
 * Users are written with the raw driver, so the model's save hook does not
 * hash the already-hashed password a second time.
 */
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const mongoose = require('mongoose');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.length ? v.join('=') : true];
  })
);
const root = path.join(__dirname, '..');
const envOf = (name) => {
  const file = path.join(root, `.env.${name}`);
  if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);
  const url = dotenv.parse(fs.readFileSync(file)).MONGODB_URL;
  if (!url) throw new Error(`MONGODB_URL is not set in .env.${name}`);
  return url;
};

// Staff only: partner portal accounts (sub-agents, school counsellors) and
// students are never copied.
const PARTNER_ROLE = /sub.?agent|school|counsell?or portal|partner|student|ambassador/i;

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z؀-ۿ]+/g, ' ')
    .trim();
const squash = (s) => norm(s).replace(/ /g, '');

function readPeople(file) {
  if (!file) return [];
  const text = fs.readFileSync(file, 'utf8');
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) rows.push([...row, cell]);
  const [head, ...body] = rows.filter((r) => r.some(Boolean));
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] || ''])));
}

/** Trello name -> production user, by full name, then squashed, then a unique first-name match. */
function matcher(prodUsers) {
  return (trelloName) => {
    const n = norm(trelloName);
    const s = squash(trelloName);
    if (!n) return { user: null, how: '' };
    let hit = prodUsers.filter((u) => norm(u.name) === n);
    if (hit.length === 1) return { user: hit[0], how: 'same name' };
    hit = prodUsers.filter(
      (u) =>
        squash(u.name) === s ||
        String(u.email)
          .split('@')[0]
          .replace(/[^a-z]/g, '') === s
    );
    if (hit.length === 1) return { user: hit[0], how: 'same name, spacing differs' };
    const first = n.split(' ')[0];
    if (first.length >= 3) {
      // first name only when the CRM account has no surname to contradict it
      // ("Aisha" for Aisha Zeenat, not "Mohammad Alrashidi" for Mohammad Almutairi)
      hit = prodUsers.filter((u) => norm(u.name) === first || (n === first && norm(u.name).split(' ')[0] === first));
      if (hit.length === 1) return { user: hit[0], how: `first name only ("${first}") — please check` };
      if (hit.length > 1) return { user: null, how: `ambiguous: ${hit.map((u) => u.name).join(' / ')}` };
    }
    return { user: null, how: '' };
  };
}

const csvCell = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;

async function main() {
  const prodUrl = envOf('production');
  const stagingUrl = envOf('staging');
  if (prodUrl === stagingUrl) throw new Error('.env.production and .env.staging point at the same database. Stopping.');

  const prod = await mongoose.createConnection(prodUrl).asPromise();
  const staging = await mongoose.createConnection(stagingUrl).asPromise();
  console.log(`Production (read only): "${prod.name}"   Staging (write): "${staging.name}"`);
  if (prod.name === staging.name) throw new Error('Both connections reached the same database name. Stopping.');
  if (args.confirm && args.confirm !== staging.name) {
    throw new Error(`--confirm=${args.confirm} does not match the staging database "${staging.name}". Nothing written.`);
  }
  const write = args.confirm === staging.name;
  const sUsers = staging.collection('users');

  if (args.rollback) {
    const m = JSON.parse(fs.readFileSync(args.rollback, 'utf8'));
    if (m.database !== staging.name) throw new Error(`Manifest is for "${m.database}", not "${staging.name}".`);
    const ids = (m.users || []).map((id) => new mongoose.Types.ObjectId(id));
    console.log(`Rollback: ${ids.length} users added by that run.`);
    if (write) {
      const r = await sUsers.deleteMany({ _id: { $in: ids } });
      console.log(`  removed ${r.deletedCount}`);
    } else console.log(`Dry run. Add --confirm=${staging.name} to remove them.`);
    return { prod, staging };
  }

  const [pRoles, sRoles] = await Promise.all([
    prod
      .collection('roles')
      .find({}, { projection: { name: 1 } })
      .toArray(),
    staging
      .collection('roles')
      .find({}, { projection: { name: 1 } })
      .toArray(),
  ]);
  const pRoleName = new Map(pRoles.map((r) => [String(r._id), r.name]));
  const sRoleByName = new Map(sRoles.map((r) => [String(r.name).trim().toLowerCase(), r]));

  const prodUsers = await prod.collection('users').find({}).toArray();
  const stagingEmails = new Set(
    (await sUsers.find({}, { projection: { email: 1 } }).toArray()).map((u) => String(u.email).toLowerCase())
  );
  const stagingIds = new Set((await sUsers.find({}, { projection: { _id: 1 } }).toArray()).map((u) => String(u._id)));

  const staff = prodUsers.filter((u) => !PARTNER_ROLE.test(pRoleName.get(String(u.role)) || ''));
  const missing = staff.filter((u) => !stagingEmails.has(String(u.email).toLowerCase()));
  console.log(
    `\nProduction users: ${prodUsers.length} (${staff.length} staff). Staff missing from staging: ${missing.length}`
  );

  // Trello names still without a CRM account
  const people = readPeople(args.people);
  const canonical = [...new Set(people.map((p) => (p['Same person as'] || p['Trello name']).trim()).filter(Boolean))];
  const hasEmail = new Set(
    people.filter((p) => p['CRM user email']).map((p) => (p['Same person as'] || p['Trello name']).trim().toLowerCase())
  );
  const find = matcher(staff);
  const matches = [];
  // every spelling Trello uses for the person ("lakkis" and "Nour Lakkis")
  const spellings = (n) => [
    n,
    ...people.filter((p) => (p['Same person as'] || '').trim() === n).map((p) => p['Trello name'].trim()),
  ];
  canonical
    .filter((n) => !hasEmail.has(n.toLowerCase()))
    .forEach((n) => {
      let res = { user: null, how: '' };
      for (const sp of spellings(n)) {
        const r = find(sp);
        if (r.user) {
          res = { user: r.user, how: sp === n ? r.how : `${r.how} (as "${sp}")` };
          break;
        }
        if (!res.how) res = r;
      }
      if (
        args.skip &&
        String(args.skip)
          .toLowerCase()
          .split(',')
          .includes(String(res.user && res.user.email).toLowerCase())
      ) {
        res = { user: null, how: 'skipped (--skip)' };
      }
      matches.push({ trelloName: n, ...res });
    });

  const want = new Map();
  matches.filter((m) => m.user).forEach((m) => want.set(String(m.user._id), m.user));
  if (args.all) missing.forEach((u) => want.set(String(u._id), u));

  const rows = [...want.values()].map((u) => {
    const roleName = pRoleName.get(String(u.role)) || '';
    const sRole = sRoleByName.get(roleName.trim().toLowerCase());
    const exists = stagingEmails.has(String(u.email).toLowerCase());
    let action = 'copy';
    if (exists) action = 'already in staging';
    else if (!sRole) action = `skip: staging has no role "${roleName}"`;
    else if (stagingIds.has(String(u._id))) action = 'skip: id already used in staging';
    return {
      u,
      roleName,
      sRole,
      action,
      trello: matches.filter((m) => m.user && String(m.user._id) === String(u._id)).map((m) => m.trelloName),
    };
  });

  console.log('\nTrello names without a CRM account:');
  matches.forEach((m) => {
    const label = m.user
      ? `${m.user.name} <${m.user.email}>  [${pRoleName.get(String(m.user.role)) || 'no role'}]  ${m.how}`
      : m.how || 'no production user found';
    console.log(`  ${m.trelloName.padEnd(26)} -> ${label}`);
  });
  console.log(`\nTo copy into staging${args.all ? ' (--all)' : ''}:`);
  rows.forEach((r) => console.log(`  ${r.action.padEnd(20)} ${r.u.name} <${r.u.email}>  role "${r.roleName}"`));
  const others = missing.filter((u) => !want.has(String(u._id)));
  if (others.length) {
    console.log(
      `\nOther production staff missing from staging, not matched to a Trello name (${others.length}; add --all to copy them too):`
    );
    others.forEach((u) => console.log(`  ${u.name} <${u.email}>  role "${pRoleName.get(String(u.role)) || ''}"`));
  }

  if (!write) {
    console.log(`\nDry run: nothing was written. To copy, add --confirm=${staging.name}`);
    return { prod, staging };
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = args.people ? path.dirname(path.resolve(args.people)) : root;
  const manifestFile = path.join(outDir, `users-copied-${stamp}.json`);
  const manifest = { database: staging.name, from: prod.name, startedAt: new Date().toISOString(), users: [] };
  for (const r of rows.filter((x) => x.action === 'copy')) {
    const { u } = r;
    const doc = {
      _id: u._id,
      name: u.name,
      email: String(u.email).toLowerCase(),
      password: u.password,
      role: r.sRole._id,
      ...(u.avatar ? { avatar: u.avatar } : {}),
      ...(u.organisation ? { organisation: u.organisation } : {}),
      createdAt: u.createdAt || new Date(),
      updatedAt: new Date(),
      __v: 0,
    };
    await sUsers.insertOne(doc);
    manifest.users.push(String(u._id));
    fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 1));
    console.log(`  ✓ copied ${u.name}`);
  }
  manifest.finishedAt = new Date().toISOString();
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 1));

  const csvFile = path.join(outDir, 'users-from-production.csv');
  const lines = [['Trello name', 'CRM name', 'CRM user email', 'Role', 'How matched', 'Result'].map(csvCell).join(',')];
  matches.forEach((m) => {
    const r = m.user && rows.find((x) => String(x.u._id) === String(m.user._id));
    lines.push(
      [
        m.trelloName,
        m.user ? m.user.name : '',
        m.user ? m.user.email : '',
        r ? r.roleName : '',
        m.how,
        r ? r.action : 'no account',
      ]
        .map(csvCell)
        .join(',')
    );
  });
  fs.writeFileSync(csvFile, `${lines.join('\n')}\n`);
  console.log(`\nDone. ${manifest.users.length} users copied. Matches: ${csvFile}`);
  console.log(`To undo: node scripts/copy-users-from-production.js --rollback="${manifestFile}" --confirm=${staging.name}`);
  return { prod, staging };
}

main()
  .then(async ({ prod, staging }) => {
    await Promise.all([prod.close(), staging.close()]);
  })
  .catch(async (e) => {
    console.error(e.message || e);
    process.exitCode = 1;
    await mongoose.disconnect();
    process.exit(1);
  });
