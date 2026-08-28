/* eslint-disable no-console */
/**
 * Who ends up with what, once authority comes from roleRights.
 *
 * Read-only. Run this BEFORE restarting the API after the roleRights
 * migration. It answers the one question that can still lock someone out:
 * is any user pointing at a role id that no longer exists as a document?
 *
 * Such a user was an admin or reviewer yesterday, via the hardcoded id list.
 * Now that real roles carry the rights, the env fallback switches itself off —
 * and a user whose role has no document has no rights at all.
 *
 *   node scripts/roleaudit.js --env=staging
 */
const path = require('path');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v === undefined ? true : v];
  })
);
if (!args.env) {
  console.error('Pass --env=staging');
  process.exit(1);
}
process.env.APP_ENV = args.env;
process.env.NODE_ENV = process.env.NODE_ENV || 'development';

// eslint-disable-next-line import/no-dynamic-require
const config = require(path.join(__dirname, '..', 'src', 'config', 'config'));
const mongoose = require('mongoose');
// eslint-disable-next-line import/no-dynamic-require
const { ADMIN_RIGHT, REVIEWER_RIGHT } = require(path.join(__dirname, '..', 'src', 'services', 'roleAccess.service'));

(async () => {
  await mongoose.connect(config.mongoose.url, config.mongoose.options || {});
  const db = mongoose.connection;
  console.log(`\ndatabase: ${db.name}\n`);

  const roles = await db.collection('roles').find({}).toArray();
  const byId = new Map(roles.map((r) => [String(r._id), r]));

  const users = await db.collection('users').find({}).project({ name: 1, email: 1, role: 1 }).toArray();

  const grouped = new Map();
  const orphaned = [];
  users.forEach((u) => {
    const id = String(u.role || '');
    if (!id) {
      orphaned.push({ u, why: 'no role at all' });
      return;
    }
    if (!byId.has(id)) {
      orphaned.push({ u, why: `role ${id} has no document` });
      return;
    }
    if (!grouped.has(id)) grouped.set(id, []);
    grouped.get(id).push(u);
  });

  console.log('role                     users  authority');
  roles.forEach((r) => {
    const rights = Array.isArray(r.roleRights) ? r.roleRights : [];
    const marks =
      [rights.includes(ADMIN_RIGHT) ? 'ADMIN' : '', rights.includes(REVIEWER_RIGHT) ? 'REVIEWER' : '']
        .filter(Boolean)
        .join(' + ') || '—';
    console.log(
      `  ${String(r.name || '(unnamed)').padEnd(22)} ${String((grouped.get(String(r._id)) || []).length).padStart(4)}   ${marks}`
    );
  });

  console.log('');
  if (!orphaned.length) {
    console.log('No user is pointing at a missing role. Safe to restart.\n');
  } else {
    console.log(`${orphaned.length} USER(S) WOULD LOSE ALL ACCESS — fix these before restarting:\n`);
    orphaned.forEach(({ u, why }) => {
      console.log(`  ${String(u.email || u.name || u._id).padEnd(38)} ${why}`);
    });
    console.log('\nPoint each at a real role, e.g. in mongosh:');
    console.log(`  db.users.updateOne({email:"someone@example.com"}, {$set:{role: ObjectId("<a real role id above>")}})\n`);
  }

  const admins = roles.filter((r) => (r.roleRights || []).includes(ADMIN_RIGHT));
  const adminUsers = admins.reduce((n, r) => n + (grouped.get(String(r._id)) || []).length, 0);
  if (!adminUsers) {
    console.log('WARNING: no USER holds an admin role. Nobody can reach the admin screens.\n');
  } else {
    console.log(`${adminUsers} user(s) hold an admin role.\n`);
  }

  await mongoose.disconnect();
})().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
