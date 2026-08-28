const { Roles } = require('../models');
const config = require('../config/config');
const logger = require('../config/logger');

/**
 * Who is an admin, who may review — answered from the roles collection, not
 * from ObjectIds pasted into source.
 *
 * WHY THIS EXISTS
 * Five role ids used to be literals in three server files and one CRM file,
 * all of which had to agree. Recreating the roles mints fresh ObjectIds, and
 * every one of those gates then fails CLOSED and silently: nobody is an admin,
 * nobody is a reviewer, the review queue is empty for everyone, and partner
 * scoping stops recognising partners. Nothing throws; the app just quietly
 * refuses everybody.
 *
 * HOW IT WORKS NOW
 * Roles carry their own authority in `roleRights`. A role with ADMIN_RIGHT is
 * an admin; one with REVIEWER_RIGHT may review. Recreate the roles with those
 * rights and everything keeps working, with no code change on either side.
 *
 * WHY IT IS A CACHE, NOT A QUERY
 * `user.role` is a bare ObjectId — the `autopopulate: true` on that path never
 * fires, because the autopopulate plugin is imported in models/plugins.js but
 * never registered on the user schema. So a gate has only an id and would
 * otherwise need a database round trip on every request, inside middleware
 * that is synchronous. Instead the whole roles collection (a handful of small
 * documents) is loaded at boot and refreshed periodically, and the gates read
 * an in-memory map.
 */

// The two rights that carry authority. Names, not ids, so they survive the
// collection being rebuilt.
const ADMIN_RIGHT = 'administerEverything';
const REVIEWER_RIGHT = 'reviewPartnerSubmissions';
// The CRM gated /courses, /inbox and /fees on a set that was ALMOST the
// reviewer set but excluded one counsellor role. Collapsing the two would have
// silently widened access, so the distinction gets its own right.
const COUNSELOR_TOOLS_RIGHT = 'useCounselorTools';

// How long a loaded snapshot is trusted. Roles change roughly never; this
// exists so that granting someone admin does not need a restart.
const TTL_MS = 5 * 60 * 1000;

let byId = new Map();
let loadedAt = 0;
let warnedAboutFallback = false;

/**
 * The transition fallback: role ids that count as admin / reviewer while no
 * role carries the rights yet.
 *
 * Read from the environment, never hardcoded — that is the entire point of
 * this module. Set them for the deploy that ships this, run the migration,
 * confirm, then delete the variables. `usingFallback()` reports whether they
 * are still load-bearing.
 */
const fallbackIds = (raw) =>
  String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const LEGACY_ADMIN_IDS = fallbackIds(process.env.LEGACY_ADMIN_ROLE_IDS);
const LEGACY_REVIEWER_IDS = fallbackIds(process.env.LEGACY_REVIEWER_ROLE_IDS);
const LEGACY_COUNSELOR_TOOLS_IDS = fallbackIds(process.env.LEGACY_COUNSELOR_TOOLS_ROLE_IDS);

/** Load the roles collection into memory. Safe to call repeatedly. */
const refresh = async () => {
  const roles = await Roles.find({}).select('name roleRights').lean();
  const next = new Map();
  roles.forEach((r) => {
    next.set(String(r._id), {
      name: r.name || '',
      rights: Array.isArray(r.roleRights) ? r.roleRights : [],
    });
  });
  byId = next;
  loadedAt = Date.now();
  return byId;
};

/**
 * Warm the cache before the server accepts traffic.
 *
 * A failure here is logged, not thrown: a database hiccup at boot must not
 * stop the process, and every gate below degrades to the env fallback, which
 * is the behaviour that shipped before this module existed.
 */
const warm = async () => {
  try {
    await refresh();
    const admins = [...byId.values()].filter((r) => r.rights.includes(ADMIN_RIGHT)).length;
    const reviewers = [...byId.values()].filter((r) => r.rights.includes(REVIEWER_RIGHT)).length;
    logger.info(`roles: ${byId.size} loaded — ${admins} admin, ${reviewers} reviewer (by roleRights)`);
    if (!admins) {
      logger.warn(
        `roles: NO role carries "${ADMIN_RIGHT}". Falling back to LEGACY_ADMIN_ROLE_IDS ` +
          `(${LEGACY_ADMIN_IDS.length} configured). Run migrations/roleRights.migration.js --apply.`
      );
    }
  } catch (err) {
    logger.error(`roles: could not load the roles collection: ${err.message}`);
  }
};

// Refresh lazily on read once the snapshot is stale. Fire-and-forget: the
// caller is a synchronous gate and answers from the current snapshot; the next
// request sees the new one.
const maybeRefresh = () => {
  if (Date.now() - loadedAt < TTL_MS) return;
  loadedAt = Date.now(); // claim the slot first, so a burst triggers one load
  refresh().catch((err) => logger.error(`roles: refresh failed: ${err.message}`));
};

/** The role id of a user, whether the path populated it or not. */
const roleIdOf = (user) => String((user && user.role && user.role._id) || (user && user.role) || '');

const rightsFor = (roleId) => {
  maybeRefresh();
  const entry = byId.get(String(roleId));
  return entry ? entry.rights : [];
};

/** True when at least one role in the collection carries `right`. */
const anyRoleHas = (right) => {
  maybeRefresh();
  return [...byId.values()].some((entry) => entry.rights.includes(right));
};

/**
 * The gate. Rights first; the env list only while no role carries the right.
 *
 * The condition is "no role has this right ANYWHERE", not "this user's role
 * lacks it". That distinction is the safety property: once the migration has
 * run, a user whose role genuinely lacks the right is denied — the fallback
 * cannot resurrect an id that was deliberately removed from the rights set.
 */
const hasAuthority = (user, right, legacyIds) => {
  if (!user) return false;
  const roleId = roleIdOf(user);
  if (!roleId) return false;
  if (anyRoleHas(right)) return rightsFor(roleId).includes(right);

  if (legacyIds.length && !warnedAboutFallback) {
    warnedAboutFallback = true;
    logger.warn('roles: answering from the LEGACY_*_ROLE_IDS fallback — run the roleRights migration');
  }
  return legacyIds.includes(roleId);
};

const isAdmin = (user) => hasAuthority(user, ADMIN_RIGHT, LEGACY_ADMIN_IDS);

// Admins review too. Kept explicit rather than relying on the migration to
// stamp both rights on the admin roles, so an admin can never lose the review
// queue through a half-applied migration.
const isReviewer = (user) => isAdmin(user) || hasAuthority(user, REVIEWER_RIGHT, LEGACY_REVIEWER_IDS);

/** Courses, Inbox and Fees — the CRM's old COUNSELOR_ROLES set. */
const canUseCounselorTools = (user) =>
  isAdmin(user) || hasAuthority(user, COUNSELOR_TOOLS_RIGHT, LEGACY_COUNSELOR_TOOLS_IDS);

// The partner roles keep coming from config: they are already env-driven
// (SUB_AGENT_ROLE_ID / SCHOOL_COUNSELOR_ROLE_ID, minted by
// subAgentRole.migration.js), which is the same property this module gives the
// internal roles. Returning false when unset is deliberate — rules keyed on
// these stay inert rather than mis-firing.
const isSubAgent = (user) => {
  const configured = config.applications.subAgentRoleId;
  return !!configured && !!user && roleIdOf(user) === String(configured);
};

const isSchoolCounselor = (user) => {
  const configured = config.applications.schoolCounselorRoleId;
  return !!configured && !!user && roleIdOf(user) === String(configured);
};

const isExternalPartner = (user) => isSubAgent(user) || isSchoolCounselor(user);

/** Staff = internal. Everyone who is not one of the two partner roles. */
const isStaff = (user) => !!user && !isExternalPartner(user);

/** True while the env fallback is still doing the work. For /health and tests. */
const usingFallback = () => !anyRoleHas(ADMIN_RIGHT);

/**
 * What the CRM is told about the signed-in user.
 *
 * The client gets these booleans and never sees a role id, so recreating the
 * roles needs no front-end change and no redeploy of the CRM.
 */
const permissionsFor = (user) => ({
  isAdmin: isAdmin(user),
  isReviewer: isReviewer(user),
  canUseCounselorTools: canUseCounselorTools(user),
  isStaff: isStaff(user),
  isSubAgent: isSubAgent(user),
  isSchoolCounselor: isSchoolCounselor(user),
});

/** Ids of every role carrying a right — for queries that need a $in list. */
const roleIdsWith = (right) => {
  maybeRefresh();
  const ids = [];
  byId.forEach((entry, id) => {
    if (entry.rights.includes(right)) ids.push(id);
  });
  if (ids.length) return ids;
  if (right === ADMIN_RIGHT) return LEGACY_ADMIN_IDS;
  if (right === REVIEWER_RIGHT) return [...new Set([...LEGACY_ADMIN_IDS, ...LEGACY_REVIEWER_IDS])];
  return [];
};

const reviewerRoleIds = () => {
  const admins = roleIdsWith(ADMIN_RIGHT);
  const reviewers = roleIdsWith(REVIEWER_RIGHT);
  return [...new Set([...admins, ...reviewers])];
};

const adminRoleIds = () => roleIdsWith(ADMIN_RIGHT);

module.exports = {
  ADMIN_RIGHT,
  REVIEWER_RIGHT,
  COUNSELOR_TOOLS_RIGHT,
  canUseCounselorTools,
  warm,
  refresh,
  roleIdOf,
  isAdmin,
  isReviewer,
  isSubAgent,
  isSchoolCounselor,
  isExternalPartner,
  isStaff,
  usingFallback,
  permissionsFor,
  adminRoleIds,
  reviewerRoleIds,
  // test seams
  _setCacheForTests: (entries) => {
    byId = new Map(entries);
    loadedAt = Date.now();
  },
  _legacy: { admin: LEGACY_ADMIN_IDS, reviewer: LEGACY_REVIEWER_IDS },
};
