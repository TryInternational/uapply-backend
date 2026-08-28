/* Behavioural check: the new registry must answer exactly as the old literal
 * arrays did, in both the fallback (pre-migration) and rights (post-migration)
 * states — and must fail CLOSED, never open. */
const path = require('path');
process.env.APP_ENV = 'staging';
process.env.NODE_ENV = 'development';

const ROOT = process.argv[2];
const ADMIN_A = '63d2ec57fdc142001c0074e6';
const ADMIN_B = '63c92057dab279194bab8d8f';
const COUNSELOR_A = '64d339237f0db6cdfb0e553c';
const COUNSELOR_B = '64df3f47ecb70a9e8a12a222';
const COUNSELOR_C = '6542253617bfc44f4cb2bba4';
const SUB_AGENT = process.env.SUB_AGENT_ROLE_ID || '';
const STRANGER = '000000000000000000000000';

// The OLD behaviour, transcribed from the literals that were in the code.
const OLD_ADMIN = [ADMIN_A, ADMIN_B];
const OLD_REVIEWER = [ADMIN_A, ADMIN_B, COUNSELOR_A, COUNSELOR_B, COUNSELOR_C];
const oldIsAdmin = (id) => OLD_ADMIN.includes(id);
const oldIsReviewer = (id) => OLD_REVIEWER.includes(id);

// Fallback state: env carries the legacy ids, no role has rights yet.
process.env.LEGACY_ADMIN_ROLE_IDS = OLD_ADMIN.join(',');
process.env.LEGACY_REVIEWER_ROLE_IDS = OLD_REVIEWER.join(',');

const svc = require(path.join(ROOT, 'src/services/roleAccess.service'));
const { ADMIN_RIGHT, REVIEWER_RIGHT } = svc;

let failures = 0;
const check = (label, got, want) => {
  const ok = got === want;
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(56)} got ${String(got).padEnd(5)} want ${want}`);
};

const asUser = (roleId) => (roleId === null ? null : { role: roleId });

// ── 1. FALLBACK STATE (migration not yet run: empty roles cache) ────────────
console.log('\n1. Before the migration — empty cache, env fallback in force\n');
svc._setCacheForTests([]);
for (const [name, id] of Object.entries({ ADMIN_A, ADMIN_B, COUNSELOR_A, COUNSELOR_B, COUNSELOR_C, STRANGER })) {
  check(`isAdmin(${name})`, svc.isAdmin(asUser(id)), oldIsAdmin(id));
  check(`isReviewer(${name})`, svc.isReviewer(asUser(id)), oldIsReviewer(id));
}

// ── 2. RIGHTS STATE (migration applied) ─────────────────────────────────────
console.log('\n2. After the migration — authority read from roleRights\n');
svc._setCacheForTests([
  [ADMIN_A, { name: 'Admin', rights: [ADMIN_RIGHT, REVIEWER_RIGHT] }],
  [ADMIN_B, { name: 'Admin B', rights: [ADMIN_RIGHT, REVIEWER_RIGHT] }],
  [COUNSELOR_A, { name: 'Counselor', rights: [REVIEWER_RIGHT] }],
  [COUNSELOR_B, { name: 'Counselor B', rights: [REVIEWER_RIGHT] }],
  [COUNSELOR_C, { name: 'Counselor C', rights: [REVIEWER_RIGHT] }],
  [STRANGER, { name: 'Some other role', rights: [] }],
]);
for (const [name, id] of Object.entries({ ADMIN_A, ADMIN_B, COUNSELOR_A, COUNSELOR_B, COUNSELOR_C, STRANGER })) {
  check(`isAdmin(${name})`, svc.isAdmin(asUser(id)), oldIsAdmin(id));
  check(`isReviewer(${name})`, svc.isReviewer(asUser(id)), oldIsReviewer(id));
}

// ── 3. ROLES RECREATED with fresh ids — the scenario that used to break ─────
console.log('\n3. Roles recreated with brand-new ObjectIds (the failure this fixes)\n');
const NEW_ADMIN = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const NEW_COUNSELOR = 'bbbbbbbbbbbbbbbbbbbbbbbb';
svc._setCacheForTests([
  [NEW_ADMIN, { name: 'Admin', rights: [ADMIN_RIGHT, REVIEWER_RIGHT] }],
  [NEW_COUNSELOR, { name: 'Counselor', rights: [REVIEWER_RIGHT] }],
]);
check('isAdmin(new admin id)', svc.isAdmin(asUser(NEW_ADMIN)), true);
check('isReviewer(new counselor id)', svc.isReviewer(asUser(NEW_COUNSELOR)), true);
check('isAdmin(OLD admin id, role now gone)', svc.isAdmin(asUser(ADMIN_A)), false);
check('legacy env cannot resurrect a removed role', svc.isAdmin(asUser(ADMIN_B)), false);

// ── 4. FAIL-CLOSED on every malformed input ────────────────────────────────
console.log('\n4. Malformed input must deny, never grant\n');
for (const bad of [null, undefined, {}, { role: null }, { role: '' }, { role: undefined }]) {
  const label = JSON.stringify(bad) || String(bad);
  check(`isAdmin(${label})`, svc.isAdmin(bad), false);
  check(`isReviewer(${label})`, svc.isReviewer(bad), false);
}

// ── 5. POPULATED role object, not just an id ───────────────────────────────
console.log('\n5. A populated role document still resolves\n');
check('isAdmin({role:{_id}})', svc.isAdmin({ role: { _id: NEW_ADMIN } }), true);
check('isReviewer({role:{_id}})', svc.isReviewer({ role: { _id: NEW_COUNSELOR } }), true);

// ── 6. permissionsFor shape ────────────────────────────────────────────────
console.log('\n6. The payload the CRM receives\n');
const perms = svc.permissionsFor({ role: NEW_ADMIN });
console.log('   ', JSON.stringify(perms));
check('admin is also a reviewer', perms.isReviewer, true);
check('admin counts as staff', perms.isStaff, true);
check('admin is not a partner', perms.isSubAgent || perms.isSchoolCounselor, false);
check('every key is a boolean', Object.values(perms).every((v) => typeof v === 'boolean'), true);

// ── 7. reviewerRoleIds() for $in queries ───────────────────────────────────
console.log('\n7. The id list used by $in queries\n');
const ids = svc.reviewerRoleIds();
check('includes the new admin', ids.includes(NEW_ADMIN), true);
check('includes the new counselor', ids.includes(NEW_COUNSELOR), true);
check('no duplicates', ids.length === new Set(ids).size, true);
svc._setCacheForTests([]);
check('falls back to env when cache empty', svc.reviewerRoleIds().length === OLD_REVIEWER.length, true);

console.log(failures === 0 ? '\nALL CHECKS PASSED\n' : `\n${failures} CHECK(S) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
