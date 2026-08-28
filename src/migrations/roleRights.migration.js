/* eslint-disable no-console */
/**
 * Stamp authority onto the roles themselves.
 *
 * THE PROBLEM THIS CLOSES
 * Five role ObjectIds were literals in three server files and one CRM file,
 * all required to agree. Recreate the roles and every gate fails closed and
 * silently — no admins, no reviewers, an empty review queue for everybody —
 * because nothing throws, the ids simply stop matching.
 *
 * After this migration, authority lives in each role's own `roleRights`:
 *
 *   administerEverything     — the admin gate (/setting, user creation, …)
 *   reviewPartnerSubmissions — may approve/reject/return partner submissions
 *
 * Recreating the roles then only means giving the new documents the same
 * rights. No code changes, no redeploy, nothing to keep in step by hand.
 *
 * ABOUT THE IDS BELOW
 * They are the ids as they exist today, and this is the last place they
 * appear. A migration is a record of a moment, not a live gate: if these ids
 * no longer exist the script reports each miss and stamps nothing, which is
 * safe — it never invents a role, and it never grants anything by name-guess.
 *
 * USAGE — dry run first, it changes nothing without --apply:
 *   node src/migrations/roleRights.migration.js --env=staging
 *   node src/migrations/roleRights.migration.js --env=staging --apply
 *
 * Idempotent: rights are added to the set, never duplicated, and no right is
 * ever removed.
 */
const path = require('path');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v === undefined ? true : v];
  })
);

if (!args.env) {
  console.error('Refusing to guess which database. Pass --env=staging (the .env suffix).');
  process.exit(1);
}
process.env.APP_ENV = args.env;
process.env.NODE_ENV = process.env.NODE_ENV || 'development';

// eslint-disable-next-line import/no-dynamic-require
const config = require(path.join(__dirname, '..', 'config', 'config'));
const mongoose = require('mongoose');
// eslint-disable-next-line import/no-dynamic-require
const { ADMIN_RIGHT, REVIEWER_RIGHT, COUNSELOR_TOOLS_RIGHT } = require(path.join(__dirname, '..', 'services', 'roleAccess.service'));

const APPLY = Boolean(args.apply);

// The internal roles as they stand, with the authority each one has TODAY.
// Taken from middlewares/subAgentScope.js (ADMIN_ROLE_IDS / REVIEWER_ROLE_IDS)
// and controllers/students.controller.js, which agreed on this exact set.
const SPECS = [
  { id: '63d2ec57fdc142001c0074e6', label: 'ADMIN_A', rights: [ADMIN_RIGHT, REVIEWER_RIGHT, COUNSELOR_TOOLS_RIGHT] },
  { id: '63c92057dab279194bab8d8f', label: 'ADMIN_B', rights: [ADMIN_RIGHT, REVIEWER_RIGHT, COUNSELOR_TOOLS_RIGHT] },
  { id: '64d339237f0db6cdfb0e553c', label: 'COUNSELOR_A', rights: [REVIEWER_RIGHT, COUNSELOR_TOOLS_RIGHT] },
  { id: '64df3f47ecb70a9e8a12a222', label: 'COUNSELOR_B', rights: [REVIEWER_RIGHT, COUNSELOR_TOOLS_RIGHT] },
  // NOT given useCounselorTools: the CRM's COUNSELOR_ROLES (which gated
  // /courses, /inbox and /fees) deliberately excluded this one. Adding it here
  // would hand this role three screens it has never had.
  { id: '6542253617bfc44f4cb2bba4', label: 'COUNSELOR_C', rights: [REVIEWER_RIGHT] },
];

(async () => {
  await mongoose.connect(config.mongoose.url, config.mongoose.options || {});
  const Role = require(path.join(__dirname, '..', 'models', 'role.model'));
  console.log(`\ndatabase: ${mongoose.connection.name}   mode: ${APPLY ? 'APPLY' : 'dry run'}\n`);

  let missing = 0;
  let changed = 0;

  for (const spec of SPECS) {
    // eslint-disable-next-line no-await-in-loop
    const role = await Role.findById(spec.id);
    if (!role) {
      missing += 1;
      console.log(`  ${spec.label.padEnd(12)} ${spec.id}  NOT FOUND — nothing stamped`);
      continue;
    }
    const before = Array.isArray(role.roleRights) ? role.roleRights : [];
    const after = [...new Set([...before, ...spec.rights])];
    const added = after.filter((r) => !before.includes(r));

    if (!added.length) {
      console.log(`  ${spec.label.padEnd(12)} "${role.name}"  already has [${spec.rights.join(', ')}]`);
      continue;
    }
    changed += 1;
    if (APPLY) {
      role.roleRights = after;
      // eslint-disable-next-line no-await-in-loop
      await role.save();
      console.log(`  ${spec.label.padEnd(12)} "${role.name}"  + ${added.join(', ')}`);
    } else {
      console.log(`  ${spec.label.padEnd(12)} "${role.name}"  would add ${added.join(', ')}`);
    }
  }

  // Every role, so you can see who ends up with authority — including any role
  // this script does not know about.
  const all = await Role.find({}).select('name roleRights').lean();
  console.log('\nauthority after this run:');
  all.forEach((r) => {
    const rights = Array.isArray(r.roleRights) ? r.roleRights : [];
    const marks = [
      rights.includes(ADMIN_RIGHT) ? 'ADMIN' : '',
      rights.includes(REVIEWER_RIGHT) ? 'REVIEWER' : '',
    ]
      .filter(Boolean)
      .join(' + ');
    console.log(`  ${String(r.name || '(unnamed)').padEnd(22)} ${String(r._id)}  ${marks || '—'}`);
  });

  const admins = all.filter((r) => (r.roleRights || []).includes(ADMIN_RIGHT)).length;
  console.log('');
  if (missing) console.log(`${missing} of the ${SPECS.length} expected roles were not found.`);
  if (!APPLY) {
    console.log(`Dry run — nothing written. ${changed} role(s) would change.`);
    console.log(`Re-run with --apply once the list above looks right.\n`);
  } else if (!admins) {
    console.log('WARNING: no role carries the admin right. The gates will stay on the');
    console.log('LEGACY_ADMIN_ROLE_IDS fallback. Do not remove those env vars yet.\n');
  } else {
    console.log(`Done. ${admins} role(s) now carry admin.`);
    console.log('Restart the API (the roles cache warms at boot), sign in, confirm admin');
    console.log('screens and the review queue still work, then remove LEGACY_*_ROLE_IDS.\n');
  }

  await mongoose.disconnect();
})().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
