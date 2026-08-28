/* eslint-disable no-console */
/**
 * Create the dedicated external-partner roles (Sub Agent, School Counselor).
 *
 *   node src/migrations/subAgentRole.migration.js                       # dry run
 *   node src/migrations/subAgentRole.migration.js --apply               # create the role
 *   node src/migrations/subAgentRole.migration.js --apply \
 *     --repoint=agent1@x.com,agent2@x.com \
 *     [--repoint-role="School Counselor"]                               # move users onto it
 *
 * WHY IT IS NEEDED
 * ----------------
 * Until now `ROLES.SUB_AGENT` and `ROLES.SCHOOL_COUNSELOR` in the CRM were the
 * SAME ObjectId (6996eb7e0433eb6a6238d1c4). A shared id makes the two roles
 * indistinguishable on the server, so no backend rule could say "sub-agents may
 * create applications but never approve them" without also saying it about
 * school counsellors. This mints a real Roles document so authorization has
 * something to key on.
 *
 * Idempotent: re-running finds the existing role by name instead of creating a
 * second one, and prints the same id.
 *
 * AFTER RUNNING
 * -------------
 * Copy each printed id into BOTH envs -- the script prints the exact lines:
 *   uapply-backend  SUB_AGENT_ROLE_ID, SCHOOL_COUNSELOR_ROLE_ID
 *   uapply-crm      REACT_APP_SUB_AGENT_ROLE_ID, REACT_APP_SCHOOL_COUNSELOR_ROLE_ID
 *
 * Until they are set, both ids are empty: every sub-agent check evaluates false
 * (the portal is inert, not open) and approving an access request REFUSES
 * rather than guessing a role. That refusal is deliberate -- the User model
 * defaults `role` to an ADMIN id, so a guess would be an admin account.
 *
 * Deploy the backend and CRM env changes together. A CRM that believes a user
 * holds one of these roles while the backend does not will render a portal
 * against endpoints that refuse it, and vice versa.
 */
const mongoose = require('mongoose');
const config = require('../config/config');

const APPLY = process.argv.includes('--apply');

// The ObjectId that meant BOTH school counsellor and sub-agent before this
// migration split them apart.
const LEGACY_SHARED_ROLE_ID = '6996eb7e0433eb6a6238d1c4';

// Rights are additive strings checked by middlewares/auth.js. Deliberately
// minimal: an external partner may create and read its OWN records and nothing
// else. Approval rights live with admins/counsellors and are never granted here.
//
// Two roles, not one. School Counselor gets a dedicated id for the same reason
// Sub Agent does: 6996eb7e0433eb6a6238d1c4 historically meant BOTH, so nothing
// keyed on it can distinguish an internal school counsellor from an outsider
// who just came through the public request-access form.
const PARTNER_ROLES = [
  {
    name: 'Sub Agent',
    rights: ['createApplication', 'getOwnApplications'],
    env: 'SUB_AGENT_ROLE_ID',
    crmEnv: 'REACT_APP_SUB_AGENT_ROLE_ID',
  },
  {
    name: 'School Counselor',
    rights: ['getOwnStudents'],
    env: 'SCHOOL_COUNSELOR_ROLE_ID',
    crmEnv: 'REACT_APP_SCHOOL_COUNSELOR_ROLE_ID',
    // Existing school counsellors are real users being moved onto a new role,
    // not new external partners. Inherit whatever roleRights the shared role
    // already carried so nothing they can do today stops working; `rights`
    // above is only the floor if the legacy doc is missing or empty.
    inheritRightsFrom: LEGACY_SHARED_ROLE_ID,
  },
];

// Which role --repoint moves users onto. Defaults to Sub Agent to match how
// this script was first used.
const repointRoleArg = process.argv.find((a) => a.startsWith('--repoint-role='));
const REPOINT_ROLE = repointRoleArg ? repointRoleArg.slice('--repoint-role='.length) : 'Sub Agent';

const repointArg = process.argv.find((a) => a.startsWith('--repoint='));
const REPOINT_EMAILS = repointArg
  ? repointArg
      .slice('--repoint='.length)
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  : [];

const run = async () => {
  await mongoose.connect(config.mongoose.url, config.mongoose.options);

  // required after connect so the models register against this connection
  // eslint-disable-next-line global-require
  const { User } = require('../models');
  // eslint-disable-next-line global-require
  const Role = require('../models/role.model');

  console.log(APPLY ? '=== APPLYING ===' : '=== DRY RUN (pass --apply to write) ===');

  const created = [];

  // eslint-disable-next-line no-restricted-syntax
  for (const spec of PARTNER_ROLES) {
    // eslint-disable-next-line no-await-in-loop
    let role = await Role.findOne({ name: spec.name });
    if (role) {
      console.log(`role "${spec.name}" already exists: ${role._id}`);
    } else if (!APPLY) {
      console.log(`would create role "${spec.name}" with rights [${spec.rights.join(', ')}]`);
      if (spec.inheritRightsFrom) {
        // eslint-disable-next-line no-await-in-loop
        const legacy = await Role.findById(spec.inheritRightsFrom);
        console.log(
          legacy && Array.isArray(legacy.roleRights) && legacy.roleRights.length
            ? `  ...plus inherited from the legacy shared role: [${legacy.roleRights.join(', ')}]`
            : `  ...legacy role ${spec.inheritRightsFrom} has no roleRights to inherit`
        );
      }
    } else {
      let { rights } = spec;
      if (spec.inheritRightsFrom) {
        // eslint-disable-next-line no-await-in-loop
        const legacy = await Role.findById(spec.inheritRightsFrom);
        if (legacy && Array.isArray(legacy.roleRights) && legacy.roleRights.length) {
          rights = [...new Set([...legacy.roleRights, ...spec.rights])];
          console.log(`  inheriting roleRights from the legacy shared role: [${legacy.roleRights.join(', ')}]`);
        } else {
          console.log(`  legacy role ${spec.inheritRightsFrom} has no roleRights to inherit; using the defaults`);
        }
      }
      // eslint-disable-next-line no-await-in-loop
      role = await Role.create({ name: spec.name, roleRights: rights });
      console.log(`created role "${spec.name}": ${role._id}  rights=[${rights.join(', ')}]`);
    }
    if (role) created.push({ spec, role });
  }

  if (REPOINT_EMAILS.length) {
    const target = created.find((c) => c.spec.name === REPOINT_ROLE);
    if (!target) {
      console.log(`WARNING: cannot repoint -- role "${REPOINT_ROLE}" does not exist yet. Re-run with --apply first.`);
    } else {
      const users = await User.find({ email: { $in: REPOINT_EMAILS } });
      const found = users.map((u) => u.email);
      const missing = REPOINT_EMAILS.filter((e) => !found.includes(e));
      if (missing.length) console.log(`WARNING: no user for ${missing.join(', ')}`);

      // eslint-disable-next-line no-restricted-syntax
      for (const user of users) {
        const from = String((user.role && user.role._id) || user.role || '');
        if (!APPLY) {
          console.log(`would repoint ${user.email}: ${from} -> ${target.role._id}`);
          // eslint-disable-next-line no-continue
          continue;
        }
        user.role = target.role._id;
        // eslint-disable-next-line no-await-in-loop
        await user.save();
        console.log(`repointed ${user.email}: ${from} -> ${target.role._id}`);
      }
    }
  }

  if (created.length) {
    console.log('');
    if (created.length === 2 && String(created[0].role._id) === String(created[1].role._id)) {
      console.log('ERROR: both roles resolved to the same id. That must never happen -- stop and investigate.');
    }
    console.log('Two DIFFERENT roles. The server refuses to boot if these two ids are set to the same value.');
    console.log('Set them before the feature does anything:');
    created.forEach(({ spec, role }) => {
      console.log(`  uapply-backend .env   ${spec.env}=${role._id}`);
      console.log(`  uapply-crm     .env   ${spec.crmEnv}=${role._id}`);
    });
  }

  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
