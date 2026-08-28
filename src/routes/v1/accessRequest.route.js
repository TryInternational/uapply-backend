const express = require('express');
const validate = require('../../middlewares/validate');
const accessRequestValidation = require('../../validations/accessRequest.validation');
const accessRequestController = require('../../controllers/accessRequest.controller');
const { accessRequestIpLimiter, accessRequestLimiter, accessRequestEmailLimiter } = require('../../middlewares/rateLimiter');
const { requireAuth, requireReviewer } = require('../../middlewares/subAgentScope');

const router = express.Router();

/**
 * Partner onboarding.
 *
 * One deliberately public route and two closed ones. The public route is the
 * only unauthenticated write this feature adds, so it carries a rate limiter, a
 * Joi schema that rejects unknown keys, and a service-layer field whitelist --
 * three independent reasons a crafted body cannot set `status`, `user`, or a
 * role id.
 *
 * The review routes use requireAuth (never the APPLICATION_AUTH-flagged
 * legacyGate): approving a request creates an account, so this surface starts
 * closed and stays closed regardless of the rollout flag.
 */

// Public: submit a request. Creates an AccessRequest row and nothing else --
// no User, no token, no session.
// Three limiters, each closing a hole the others leave open: a plain per-IP
// volume ceiling (a caller cannot flood by varying the address), network+address
// (cannot mail one victim repeatedly), and address alone (many networks cannot
// gang up on one victim). All run before Joi so a malformed flood stays cheap.
router.post(
  '/',
  accessRequestIpLimiter,
  accessRequestLimiter,
  accessRequestEmailLimiter,
  validate(accessRequestValidation.submitAccessRequest),
  accessRequestController.submitAccessRequest
);

// Reviewers: the queue.
router.get(
  '/',
  requireAuth,
  requireReviewer,
  validate(accessRequestValidation.listAccessRequests),
  accessRequestController.getAccessRequests
);

// Reviewers: approve or decline. This is where an account is created.
router.post(
  '/:requestId/decision',
  requireAuth,
  requireReviewer,
  validate(accessRequestValidation.decideAccessRequest),
  accessRequestController.decideAccessRequest
);

// Reviewers: resend an expired or undelivered invite. Approved requests only.
router.post(
  '/:requestId/resend-invite',
  requireAuth,
  requireReviewer,
  validate(accessRequestValidation.resendInvite),
  accessRequestController.resendInvite
);

module.exports = router;
