const express = require('express');
const multer = require('multer');
const httpStatus = require('http-status');
const validate = require('../../middlewares/validate');
const ApiError = require('../../utils/ApiError');
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

// Public: the Civil ID scan, sent as soon as the applicant picks it. Memory
// storage with a hard cap; the service re-checks type and size and stores the
// object privately. Same per-network limiter as the submission itself.
const civilIdUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
}).single('file');
router.post(
  '/civil-id',
  accessRequestIpLimiter,
  (req, res, next) => {
    civilIdUpload(req, res, (err) => {
      if (err) {
        return next(
          new ApiError(
            httpStatus.BAD_REQUEST,
            err.code === 'LIMIT_FILE_SIZE' ? 'The Civil ID file is larger than 8 MB' : 'Could not read the uploaded file'
          )
        );
      }
      return next();
    });
  },
  accessRequestController.uploadCivilId
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

// Reviewers: a short-lived link to the Civil ID scan on one request.
router.get(
  '/:requestId/civil-id',
  requireAuth,
  requireReviewer,
  validate(accessRequestValidation.civilIdLink),
  accessRequestController.civilIdLink
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
