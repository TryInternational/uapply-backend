/**
 * Authorization helpers for the Sub-Agent role.
 *
 * CONTEXT THIS FILE EXISTS IN
 * ---------------------------
 * `/application` and `/students` have never been authenticated: their route
 * files either never imported `auth` or imported it and never called it, so
 * `req.user` did not exist in those controllers. Every ownership decision was
 * therefore made from client-supplied fields, and the CRM filtered a sub-agent's
 * own students in the BROWSER (see uapply-crm useAgentStudents.ts).
 *
 * Turning auth on across those routes in one step would 401 the entire back
 * office, so this file provides two different gates:
 *
 *   legacyGate  - for routes that already existed. Behaviour is controlled by
 *                 APPLICATION_AUTH. Off (default): requests without a token
 *                 still pass, but a request WITH a valid token is still
 *                 identified, so ownership scoping works for the CRM today.
 *                 On: a valid token is mandatory.
 *   requireAuth - for routes added by this feature. Always mandatory,
 *                 regardless of the flag. New surface starts closed.
 *
 * `subAgentRoleId` is empty until the migration has run and the env is set.
 * Every predicate here compares against it, so an unset value means no user is
 * ever classified as a sub-agent: the portal capability is inert, and the deny
 * rules below simply never fire. It never widens access.
 */
const passport = require('passport');
const httpStatus = require('http-status');
const ApiError = require('../utils/ApiError');
const auth = require('./auth');
const config = require('../config/config');

// Who is an admin and who may review is no longer decided here. Five role
// ObjectIds used to be literals in this file, students.controller.js,
// whatsapp.services.js and the CRM's constants/roles.ts, all of which had to
// agree; recreating the roles minted fresh ids and every gate failed closed in
// silence. Authority now lives on the role documents themselves — see
// services/roleAccess.service.js.
//
// ADMIN_ROLE_IDS / REVIEWER_ROLE_IDS are still exported below, because callers
// need id lists for `$in` queries, but they are now READ FROM THE DATABASE.
const roleAccess = require('../services/roleAccess.service');

// `user.role` is a bare ObjectId. The `autopopulate: true` on that path never
// fires — mongoose-autopopulate is imported in models/plugins.js but never
// registered on the user schema — so the populated branch here is defensive,
// for the query paths that populate by hand.
// Plain functions, so destructuring is safe here — unlike the ADMIN_ROLE_IDS /
// REVIEWER_ROLE_IDS getters below, which must be read at call time.
const { roleIdOf, isSubAgent, isReviewer, isSchoolCounselor, isAdmin } = roleAccess;

/**
 * A school counsellor on the DEDICATED role.
 *
 * Deliberately not the legacy 6996eb7e0433eb6a6238d1c4: that id meant both
 * school counsellor and sub-agent, so matching it would sweep in sub-agents.
 * Returns false until SCHOOL_COUNSELOR_ROLE_ID is configured, which means the
 * rules keyed on this stay inert rather than mis-firing.
 */
/** Either external partner type. Both submit students for staff to review. */
const isExternalPartner = (user) => isSubAgent(user) || isSchoolCounselor(user);

/**
 * Identify the caller if it presents a valid token, but never reject it.
 * Used only while APPLICATION_AUTH is off, so that scoping already applies to
 * the authenticated CRM without breaking whatever still calls these routes
 * without a token.
 */
/**
 * Identify the caller when a token is presented; stay anonymous when none is.
 *
 * IMPORTANT: a token that IS presented but fails to verify — expired, tampered,
 * signed with the wrong secret — is now REJECTED with 401 rather than waved
 * through as anonymous.
 *
 * That distinction was the cause of a real bug. Access tokens expire after 30
 * minutes; when a school counsellor's lapsed, this middleware dropped them to
 * anonymous, `isExternalPartner(req.user)` went false, and GET /students fell
 * past the partner-scoped branch into the STAFF query path. That path filters
 * on `assignedTo.userRole`, which never matches a partner, so the API answered
 * `200 []` and their students silently vanished until they signed in again.
 *
 * Callers that present no Authorization header at all still pass through, so
 * legacy token-less integrations behave exactly as before.
 */
const softAuth = (req, res, next) => {
  const presented = !!(req.headers && req.headers.authorization);
  passport.authenticate('jwt', { session: false }, (err, user) => {
    if (user) {
      req.user = user;
      return next();
    }
    if (presented) {
      // Say so plainly: the client can then refresh and retry, which is far
      // better than being handed someone else's view of the data.
      return next(new ApiError(httpStatus.UNAUTHORIZED, 'Session expired'));
    }
    return next();
  })(req, res, next);
};

/** Gate for routes that predate this feature. See the header comment. */
const legacyGate = config.applications.authEnabled ? auth() : softAuth;

/** Gate for routes introduced by this feature. Always requires a token. */
const requireAuth = auth();

/**
 * Refuse the request when the caller is a sub-agent.
 *
 * Note the asymmetry with requireSubAgent/requireReviewer below: this one is a
 * DENY rule, so an unidentified caller (APPLICATION_AUTH off, no token) passes
 * through. That is the documented state of the flag, not an oversight -- an
 * unauthenticated caller on a legacy route was already unrestricted before this
 * change. The warning makes the remaining gap visible in the logs.
 */
const denySubAgent = (req, res, next) => {
  // Despite the name, this refuses ANY external partner — school counsellors
  // included. Every mount using it (staff-only routers, aggregates, the
  // application PATCH/DELETE) is exactly as off-limits to a partner school as
  // to a sub-agent.
  if (isExternalPartner(req.user)) {
    return next(new ApiError(httpStatus.FORBIDDEN, 'Partner accounts cannot perform this action'));
  }
  // No warning is logged for an unidentified caller: this guard is also mounted
  // on public endpoints (the WhatsApp webhook, the payment redirect, public
  // lead capture), where unauthenticated is the normal case and a warning per
  // request would just flood the log.
  return next();
};

/** Allow only sub-agents. Used on the portal-only endpoints. */
const requireSubAgent = (req, res, next) => {
  if (!isSubAgent(req.user)) {
    return next(new ApiError(httpStatus.FORBIDDEN, 'Sub-agent access only'));
  }
  return next();
};

/**
 * Sub-agent policy for /users, which the portal legitimately needs: the comment
 * thread reads the staff roster for @mentions, and the profile screen PATCHes
 * the agent's own record. Everything else on that router (create, paginated
 * list, delete, and reads/writes of OTHER users) is refused.
 */
const scopeSubAgentUsers = (req, res, next) => {
  if (!isExternalPartner(req.user)) return next();

  // Roster read used by the @mention autocomplete.
  if (req.method === 'GET' && (req.path === '/users' || req.path === '/users/')) return next();

  // Self only, for the agent's own profile screen.
  const target = (req.path || '').replace(/^\//, '').split('/')[0];
  if ((req.method === 'GET' || req.method === 'PATCH') && target && String(target) === String(req.user.id)) {
    return next();
  }

  return next(new ApiError(httpStatus.FORBIDDEN, 'Sub-agents cannot access other users'));
};

/**
 * Per-student resources (documents, comments, notes, activities).
 *
 * These routers key everything off a student id, so a sub-agent holding a valid
 * token could read another agent's documents, internal staff commentary or
 * activity timeline just by passing that student's id -- the /students scoping
 * does not help, because the request never touches /students.
 *
 * The rule: resolve the student id from wherever this router puts it, and apply
 * the same ownership predicate /students/:studentId uses. A request with NO
 * student id at all is refused rather than allowed, because an unscoped list
 * (GET /notes with no studentId, GET /documents) spans every student.
 *
 * Requires the models at call time to avoid a circular require at module load
 * (models -> plugins -> config, and routes -> middlewares -> models).
 */
const scopeSubAgentToOwnStudent = async (req, res, next) => {
  if (!isExternalPartner(req.user)) return next();

  // `req.params` is EMPTY at a pathless router.use(): Express populates route
  // params only once the route layer itself matches, which happens after this
  // middleware runs. So the '/student/:studentId' shape has to be read off
  // req.path. (req.query and req.body are both already populated here --
  // express.json() runs in app.js before the router.)
  const fromPath = /^\/student\/([^/]+)/.exec(req.path || '');

  const studentId =
    (fromPath && fromPath[1]) ||
    (req.params && req.params.studentId) ||
    (req.query && req.query.studentId) ||
    (req.body && (req.body.studentId || req.body.student));

  if (!studentId) {
    return next(new ApiError(httpStatus.FORBIDDEN, 'A student must be specified'));
  }

  try {
    // eslint-disable-next-line global-require
    const { Students } = require('../models');
    const student = await Students.findById(studentId).select('createdBy assignedTo');
    const owns =
      !!student &&
      ((student.createdBy && String(student.createdBy) === String(req.user.id)) ||
        (student.assignedTo || []).some((a) => a && a.user && String(a.user) === String(req.user.id)));
    if (!owns) {
      // 404, matching /students/:studentId, so ids cannot be probed.
      return next(new ApiError(httpStatus.NOT_FOUND, 'Student not found'));
    }
  } catch (err) {
    return next(new ApiError(httpStatus.NOT_FOUND, 'Student not found'));
  }

  return next();
};

/**
 * Notifications are addressed to a user, not a student, so these two are
 * attached at ROUTE level rather than with router.use() -- a pathless use()
 * cannot see :userId / :notificationId (see the note in
 * scopeSubAgentToOwnStudent).
 */

/** GET /notifications/:userId -- a sub-agent may read only its own feed. */
const scopeSubAgentNotificationFeed = (req, res, next) => {
  if (!isExternalPartner(req.user)) return next();
  if (String(req.params.userId) !== String(req.user.id)) {
    return next(new ApiError(httpStatus.NOT_FOUND, 'Not found'));
  }
  return next();
};

/**
 * PUT /notifications/:notificationId/read|unread -- a sub-agent may only mark
 * a notification that was addressed to them.
 */
const scopeSubAgentNotificationDoc = async (req, res, next) => {
  if (!isExternalPartner(req.user)) return next();
  try {
    // eslint-disable-next-line global-require
    const { Notifications } = require('../models');
    const notification = await Notifications.findById(req.params.notificationId).select('userIds');
    const addressed = !!notification && (notification.userIds || []).some((id) => String(id) === String(req.user.id));
    if (!addressed) {
      return next(new ApiError(httpStatus.NOT_FOUND, 'Notification not found'));
    }
  } catch (err) {
    return next(new ApiError(httpStatus.NOT_FOUND, 'Notification not found'));
  }
  return next();
};

/**
 * Allow only admins.
 *
 * Deliberately an ID check rather than auth('manageUsers'). The rights strings
 * live in the `roles` collection, and this service cannot verify what any given
 * deployment's admin Role document actually carries -- if it happens to lack
 * 'manageUsers', a rights-based gate would lock every admin out of creating
 * users. The two admin ObjectIds are already relied on throughout the codebase
 * and the CRM, so they are the dependable check.
 */
const requireAdmin = (req, res, next) => {
  if (!isAdmin(req.user)) {
    return next(new ApiError(httpStatus.FORBIDDEN, 'Admin access only'));
  }
  return next();
};

/**
 * Allow a user to act on their OWN record, or an admin to act on anyone's.
 *
 * This is what the swagger comments in user.route.js have always claimed
 * ("Logged in users can only update their own information. Only admins can
 * update other users") and what the routes never actually enforced -- PATCH
 * accepts `password`, so an unauthenticated caller could reset any account's
 * password, admins included, and then sign in as them.
 */
const requireSelfOrAdmin = (req, res, next) => {
  if (isAdmin(req.user)) return next();
  if (req.user && String(req.params.userId) === String(req.user.id)) return next();
  return next(new ApiError(httpStatus.FORBIDDEN, 'You can only change your own account'));
};

/** Allow only admins/counsellors. Used on the approval endpoints. */
/**
 * School-counsellor-only routes.
 *
 * Deliberately NOT requireSubAgent-with-a-wider-predicate: the sub-agent portal
 * keeps its own endpoints unchanged, and a rule written for one partner must
 * not silently start applying to the other.
 */
const requireSchoolCounselor = (req, res, next) => {
  if (!isSchoolCounselor(req.user)) {
    return next(new ApiError(httpStatus.FORBIDDEN, 'School counsellor access only'));
  }
  return next();
};

const requireReviewer = (req, res, next) => {
  if (!isReviewer(req.user)) {
    return next(new ApiError(httpStatus.FORBIDDEN, 'Reviewer access only'));
  }
  return next();
};

module.exports = {
  // Getters, not frozen arrays: the underlying data can be refreshed while the
  // process runs, and a module-load-time snapshot would go stale silently.
  get ADMIN_ROLE_IDS() {
    return roleAccess.adminRoleIds();
  },
  get REVIEWER_ROLE_IDS() {
    return roleAccess.reviewerRoleIds();
  },
  roleIdOf,
  isSubAgent,
  isSchoolCounselor,
  isExternalPartner,
  isReviewer,
  isAdmin,
  requireAdmin,
  requireSelfOrAdmin,
  softAuth,
  legacyGate,
  requireAuth,
  denySubAgent,
  requireSubAgent,
  requireSchoolCounselor,
  requireReviewer,
  scopeSubAgentUsers,
  scopeSubAgentToOwnStudent,
  scopeSubAgentNotificationFeed,
  scopeSubAgentNotificationDoc,
};
