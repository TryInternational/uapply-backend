const httpStatus = require('http-status');
const crypto = require('crypto');
const { DateTime } = require('luxon');
const config = require('../config/config');
const ApiError = require('../utils/ApiError');
const { AccessRequest, Token } = require('../models');
const Role = require('../models/role.model');
const userService = require('./user.service');
const emailService = require('./email.service');
const logger = require('../config/logger');
const tokenService = require('./token.service');
const { tokenTypes } = require('../config/tokens');

/**
 * Requested-role name -> role ObjectId.
 *
 * This map is the privilege boundary of the whole onboarding flow. The public
 * request endpoint accepts a role NAME constrained to the two keys below, and
 * only this function ever turns one into an id, so there is no request body --
 * at request time or at approval time -- that can produce an admin or
 * counsellor account.
 *
 * A missing sub-agent id throws rather than falling through. It used to matter
 * even more than it looks: `user.model.js` defaulted `role` to an ADMIN id, so
 * silently creating a user without an explicit role handed an external partner
 * an admin account. That default is gone — a role-less user now fails every
 * gate — but this still throws, because a partner with NO role is a broken
 * account, not a safe one.
 */
// Role NAME per requestable role, matching exactly what
// src/migrations/subAgentRole.migration.js creates. Object.create(null), not a
// plain literal: on a literal, `map.constructor` and `map.toString` resolve to
// inherited FUNCTIONS, which are truthy, so a lookup miss would sail past the
// guard below. Joi and the schema enum both pin `requestedRole` today, but this
// is the privilege boundary of the whole flow and should not rely on callers.
const ROLE_NAME_FOR_REQUESTED_ROLE = Object.assign(Object.create(null), {
  subAgent: 'Sub Agent',
  schoolCounselor: 'School Counselor',
});

// Resolved ids, cached after the first successful lookup. Roles are created
// once by the migration and never renamed, so a per-approval query would be
// pure overhead. Only successes are cached -- a miss is retried, so creating
// the role does not require a restart.
const resolvedRoleIds = new Map();

/**
 * Which role a requested-role NAME maps to.
 *
 * Two sources, in order:
 *   1. The env override (SUB_AGENT_ROLE_ID / SCHOOL_COUNSELOR_ROLE_ID), for
 *      pinning a specific id — an explicit choice always wins.
 *   2. The `roles` collection, looked up by the exact name the migration
 *      creates. This is why approving works as soon as the migration has run,
 *      with no env editing and no restart.
 *
 * What it never does is fall back to a DEFAULT. Guessing a role for an unvetted
 * outsider is wrong whatever the guess would be. Not finding the role is an
 * error, and the caller unwinds the request rather than provisioning.
 */
const roleIdForRequestedRole = async (requestedRole) => {
  const envOverride = Object.assign(Object.create(null), {
    subAgent: config.applications.subAgentRoleId,
    schoolCounselor: config.applications.schoolCounselorRoleId,
  })[requestedRole];
  if (envOverride) return envOverride;

  const roleName = ROLE_NAME_FOR_REQUESTED_ROLE[requestedRole];
  if (!roleName) {
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, `"${requestedRole}" is not a requestable role`);
  }

  if (resolvedRoleIds.has(roleName)) return resolvedRoleIds.get(roleName);

  // Exact name, case-insensitive and anchored, so "School counselor" still
  // matches but "Admin School Counselor" does not. roleName is a constant from
  // the map above, never user input.
  // roleName comes from ROLE_NAME_FOR_REQUESTED_ROLE above -- a module
  // constant, never anything from the request.
  // eslint-disable-next-line security/detect-non-literal-regexp
  const role = await Role.findOne({ name: new RegExp(`^${roleName}$`, 'i') });
  if (!role) {
    const envVar = requestedRole === 'subAgent' ? 'SUB_AGENT_ROLE_ID' : 'SCHOOL_COUNSELOR_ROLE_ID';
    throw new ApiError(
      httpStatus.INTERNAL_SERVER_ERROR,
      `No "${roleName}" role exists in this database. Run: APP_ENV=<staging|production> NODE_ENV=production ` +
        `node src/migrations/subAgentRole.migration.js --apply  (or set ${envVar} to an existing role id).`
    );
  }

  resolvedRoleIds.set(roleName, role._id);
  return role._id;
};

/** The fields a member of the public may write. Everything else is server-owned. */
const PUBLIC_FIELDS = [
  'requestedRole',
  'name',
  'email',
  'phoneCode',
  'phone',
  'organisation',
  'country',
  'city',
  'website',
  'note',
];

/**
 * @param {object} body        the request body, filtered through PUBLIC_FIELDS
 * @param {object} serverFields fields the SERVER decides (existingAccount,
 *                              previousStatus, previousReason)
 *
 * Two parameters on purpose. Server-owned fields are merged AFTER the
 * whitelist rather than being added to it: putting them in PUBLIC_FIELDS would
 * make them settable from the public body, and leaving them out of the merge --
 * as the first version did -- silently dropped them, so `existingAccount` was
 * always false and the reviewer never saw the warnings that depend on it.
 * status, user and decision stay owned by the schema default and the review
 * endpoint respectively.
 */
const createAccessRequest = async (body, serverFields = {}) => {
  const filtered = {};
  PUBLIC_FIELDS.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(body, field)) filtered[field] = body[field];
  });
  return AccessRequest.create({ ...filtered, ...serverFields });
};

/**
 * Is there already a live request or account for this email?
 *
 * The caller uses this to decide whether to send a second acknowledgement, NOT
 * to decide what to answer -- the endpoint returns the same response either
 * way, so the form cannot be used to test which emails are registered.
 */
const findLiveRequestByEmail = async (email) => {
  return AccessRequest.findOne({ email: String(email).toLowerCase(), status: 'Pending' });
};

/**
 * The most recent request for an address, whatever its status. Used to carry a
 * previous decision forward onto a resubmission, so a declined applicant does
 * not reappear in the queue looking brand new.
 */
const findLatestRequestByEmail = async (email) => {
  return AccessRequest.findOne({ email: String(email).toLowerCase() }).sort({ createdAt: -1 });
};

const queryAccessRequests = async ({ status, limit = 100 } = {}) => {
  const filter = {};
  if (status) filter.status = status;
  return AccessRequest.find(filter).sort({ createdAt: -1 }).limit(limit);
};

const getAccessRequestById = async (id) => AccessRequest.findById(id);

/**
 * Record a decision, conditional on the request still being Pending.
 *
 * Conditional for the same reason the application review is: two reviewers
 * opening the queue together must not both be able to decide, or one of them
 * provisions an account the other just declined.
 */
const recordDecision = async (id, { to, by, byName, reason }) => {
  return AccessRequest.findOneAndUpdate(
    { _id: id, status: 'Pending' },
    { $set: { status: to, decision: { by, byName, at: new Date(), reason } } },
    { new: true }
  );
};

/**
 * Create the portal account for an approved request.
 *
 * The password is random and is never sent anywhere: the applicant sets their
 * own through the emailed reset-password link. That is what makes the account
 * unusable in the window between approval and the applicant clicking through.
 */
const provisionUserForRequest = async (request) => {
  const role = await roleIdForRequestedRole(request.requestedRole);
  const throwawayPassword = `${crypto.randomBytes(24).toString('hex')}A1`;
  return userService.createUser({
    name: request.name,
    email: request.email,
    password: throwawayPassword,
    role,
    // Carried across so the portal can say which school or agency they are
    // from. Nothing else links a User back to the request that created it.
    organisation: request.organisation,
    // Only ever set on the staff-created path; undefined for public requests,
    // where staff add the logo later from the directory.
    organisationLogo: request.organisationLogo || undefined,
  });
};

/**
 * The one-time link an approved partner uses to set their first password.
 *
 * A RESET_PASSWORD token, so authService.resetPassword consumes it unchanged --
 * but generated here rather than through generateResetPasswordToken, because
 * that helper hardcodes config.jwt.resetPasswordExpirationMinutes (10). Ten
 * minutes is right for "I clicked forgot password just now" and useless for an
 * onboarding invite somebody opens after lunch.
 */
const generateInviteToken = async (user) => {
  const hours = config.applications.inviteExpirationHours;
  // Drop any outstanding invite for this account first. Otherwise every resend
  // leaves another live 48-hour link behind, and only a successful reset clears
  // them -- so a superseded link keeps working.
  await Token.deleteMany({ user: user.id, type: tokenTypes.RESET_PASSWORD });
  const expires = DateTime.now().plus({ hours });
  const token = tokenService.generateToken(user.id, expires, tokenTypes.RESET_PASSWORD);
  await tokenService.saveToken(token, user.id, expires, tokenTypes.RESET_PASSWORD);
  return { token, hours };
};

/**
 * Where an approved partner lands. Sub-agents get the dedicated portal host,
 * school counsellors the staff back office; both set their password on the same
 * /reset-password route the forgot-password flow already uses.
 */
const portalUrlFor = (requestedRole) =>
  requestedRole === 'subAgent' ? config.appUrls.subAgentPortal : config.appUrls.backoffice;

/**
 * welcome=1 makes the shared reset-password screen say "Set your password"
 * rather than "Reset" -- this person has never had one.
 *
 * `portal` tells that screen which sign-in door to hand them afterwards. Each
 * audience has its own (/sub-agent/login, /school/login), and without this a
 * school counsellor finishing their invite was dropped on the STAFF login at
 * "/", which is not a page they can use.
 */
const setPasswordUrl = (requestedRole, token) =>
  `${portalUrlFor(requestedRole)}/reset-password?token=${token}&welcome=1&portal=${requestedRole}`;

/**
 * Provision, then invite.
 *
 * Lives here rather than in a controller because BOTH ways a partner account
 * comes into existence end in this call: a reviewer approving a request, and an
 * admin adding a partner directly from the directory. Two copies of it would
 * drift, and the one that drifted would email somebody a broken link.
 */
const sendInvite = async (request, user) => {
  const { token, hours } = await generateInviteToken(user);
  const url = setPasswordUrl(request.requestedRole, token);

  // LOCAL DEV ONLY: print the link so the flow can be walked end to end without
  // a working mailbox. Guarded on the portal URL being a local one rather than
  // on NODE_ENV, because `npm run dev` runs with NODE_ENV=production against
  // APP_ENV=staging -- so an env check would never fire locally and, worse,
  // might fire somewhere real. A deployed host never matches this.
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(portalUrlFor(request.requestedRole))) {
    logger.info(`[local dev] set-password link for ${request.email}: ${url}`);
  }

  await emailService.sendAccessApprovedEmail(request, {
    setPasswordUrl: url,
    portalUrl: portalUrlFor(request.requestedRole),
    expiryHours: hours,
  });
};

module.exports = {
  portalUrlFor,
  sendInvite,
  PUBLIC_FIELDS,
  ROLE_NAME_FOR_REQUESTED_ROLE,
  findLatestRequestByEmail,
  generateInviteToken,
  roleIdForRequestedRole,
  createAccessRequest,
  findLiveRequestByEmail,
  queryAccessRequests,
  getAccessRequestById,
  recordDecision,
  provisionUserForRequest,
};
