const httpStatus = require('http-status');
const logger = require('../config/logger');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');
const { accessRequestService, userService, emailService, notificationsService, agreementService } = require('../services');
const { User } = require('../models');
// NOT destructured: the reviewer id list is now read from the roles collection
// and can change while the process runs. Pulling it apart at import time would
// capture the cache before it is warm — an empty list, and every reviewer
// notification would silently go to nobody.
const { reviewerRoleIds } = require('../services/roleAccess.service');

// portalUrlFor / setPasswordUrl / sendInvite moved to accessRequest.service:
// an admin adding a partner directly from the directory ends in the same
// invite, and two copies of the link-building would drift.

// Indexed lookup instead of loading the whole users collection and filtering in
// JS, which the public endpoint would otherwise do on every submission.
const reviewerIds = async () => {
  const reviewers = await User.find({ role: { $in: reviewerRoleIds() } }).select('_id');
  return reviewers.map((u) => u._id.toString());
};

// One response for every outcome of the public endpoint.
//
// Whether the email is new, already has a pending request, or already has an
// account, the caller sees exactly this. Varying the answer would turn the form
// into an oracle for which addresses are registered with Ulearn.
const ACK = {
  message: "Thanks - we have your request. If it's approved you'll get an email with a link to set your password.",
};

/**
 * POST /access-requests  (public, rate-limited)
 *
 * Answers immediately and does the email + notification AFTER responding. The
 * identical response body is only half of not leaking which addresses are
 * known: awaiting a Resend HTTPS call on one branch and not on another makes
 * the latency itself the oracle.
 */
const submitAccessRequest = catchAsync(async (req, res) => {
  const email = String(req.body.email).toLowerCase();

  // Verified before anything is written: a forged or expired receipt is a 400
  // the applicant can act on (re-attach the file), not a half-saved request.
  const civilId = req.body.civilIdUpload ? accessRequestService.verifyCivilIdReceipt(req.body.civilIdUpload) : undefined;

  const [existingUser, pending, latest] = await Promise.all([
    userService.getUserByEmail(email),
    accessRequestService.findLiveRequestByEmail(email),
    accessRequestService.findLatestRequestByEmail(email),
  ]);

  // A second submission while the first is still pending re-uses that row
  // rather than filling the reviewer queue with duplicates.
  let request = pending;
  if (!request) {
    request = await accessRequestService.createAccessRequest(
      { ...req.body, email },
      {
        // Someone who already has an account almost never needs a second one --
        // but the row is still created so the request leaves a trace a reviewer
        // can act on, instead of disappearing behind a cheerful acknowledgement.
        existingAccount: Boolean(existingUser),
        // Carry the last decision forward so a declined applicant does not
        // reappear in the queue looking brand new.
        previousStatus: latest && latest.status !== 'Pending' ? latest.status : undefined,
        previousReason: latest && latest.decision ? latest.decision.reason : undefined,
        civilId,
      }
    );
  } else if (civilId || req.body.organisationDetails || req.body.personInCharge) {
    // A resubmission while the first is pending: keep the one row, but let the
    // newer paperwork win -- this is how an applicant fixes a wrong upload.
    const refresh = {};
    if (civilId) refresh.civilId = civilId;
    if (req.body.organisationDetails) refresh.organisationDetails = req.body.organisationDetails;
    if (req.body.personInCharge) refresh.personInCharge = req.body.personInCharge;
    if (req.body.title) refresh.title = req.body.title;
    if (req.body.nameAr) refresh.nameAr = req.body.nameAr;
    if (req.body.organisationAr) refresh.organisationAr = req.body.organisationAr;
    await accessRequestService.updatePendingPaperwork(request.id, refresh);
  }

  res.status(httpStatus.ACCEPTED).send(ACK);

  // ---- after the response ----
  // None of this is worth failing the request over: the row is saved either
  // way and a reviewer will still see it in the queue.
  setImmediate(async () => {
    try {
      // Only acknowledge a NEW request. Re-sending on every repeat submission
      // turns the form into a way to mail an address the caller does not own.
      if (!pending) {
        await emailService.sendAccessRequestReceivedEmail(request);
      }
    } catch (err) {
      logger.error(`Access-request acknowledgement email failed: ${err.message}`);
    }

    try {
      if (!pending) {
        const recipientIds = await reviewerIds();
        if (recipientIds.length) {
          const roleLabel = emailService.ACCESS_ROLE_LABEL[request.requestedRole] || 'portal';
          await notificationsService.createNotification(
            req.app.get('io'),
            recipientIds,
            `${request.name} (${request.organisation}) requested ${roleLabel} access.`,
            'system',
            undefined,
            undefined,
            undefined
          );
        }
      }
    } catch (err) {
      logger.error(`Access-request reviewer notification failed: ${err.message}`);
    }
  });
});

/**
 * GET /access-requests  (reviewers only)
 */
const getAccessRequests = catchAsync(async (req, res) => {
  const requests = await accessRequestService.queryAccessRequests({
    status: req.query.status,
    limit: Number(req.query.limit) || 100,
  });
  res.send(requests);
});

/**
 * POST /access-requests/:requestId/decision  (reviewers only)
 *
 * Approving is the only place in the codebase where an external party gets an
 * account, so the order matters: record the decision FIRST, conditional on the
 * request still being Pending, and only then provision. Two reviewers deciding
 * at once means one of them gets the 409 rather than both creating a user.
 */
const decideAccessRequest = catchAsync(async (req, res) => {
  const { decision, reason } = req.body;

  if (decision === 'Declined' && !String(reason || '').trim()) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'A reason is required when declining a request');
  }

  const existing = await accessRequestService.getAccessRequestById(req.params.requestId);
  if (!existing) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Access request not found');
  }
  if (existing.status !== 'Pending') {
    throw new ApiError(httpStatus.CONFLICT, `This request was already ${existing.status.toLowerCase()}`);
  }

  const request = await accessRequestService.recordDecision(req.params.requestId, {
    to: decision,
    by: req.user.id,
    byName: req.user.name,
    reason,
  });
  if (!request) {
    throw new ApiError(httpStatus.CONFLICT, 'This request was already decided by someone else');
  }

  if (decision === 'Declined') {
    try {
      await emailService.sendAccessDeclinedEmail(request, reason);
    } catch (err) {
      logger.error(`Access-request decline email failed: ${err.message}`);
    }
    return res.send(request);
  }

  // ---- approval ----
  // createUser would reject this with "Email already taken" and the rollback
  // below would put it straight back in the queue, failing identically for
  // ever. Answer the reviewer properly instead.
  //
  // Checked LIVE, not from the stored existingAccount flag: the address may
  // have gained an account between submission and approval (staff created one
  // by hand, or a duplicate request was approved first), and the stored flag
  // would still say false.
  const clashingUser = await userService.getUserByEmail(request.email);
  if (request.existingAccount || clashingUser) {
    request.status = 'Pending';
    request.decision = undefined;
    await request.save();
    throw new ApiError(
      httpStatus.CONFLICT,
      `${request.email} already has an account. Ask them to sign in, or use Forgot password — approving cannot create a second one.`
    );
  }

  // ---- sub-agents: the agreement comes first --------------------------------
  // Approving a sub-agent sends them the agreement with the deal the reviewer
  // just set. Nothing is provisioned until it is signed by both parties: that
  // happens in agreementService.complete, which creates the account and sends
  // the set-password invite. `skipAgreement` is the escape hatch for a partner
  // whose contract already exists on paper.
  if (request.requestedRole === 'subAgent' && !req.body.skipAgreement) {
    if (!req.body.agreement) {
      request.status = 'Pending';
      request.decision = undefined;
      await request.save();
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Set the commission for this sub-agent before approving, or tick "no agreement needed".'
      );
    }
    const existingAgreement = await agreementService.getByAccessRequest(request._id);
    if (existingAgreement && !['Voided', 'Declined', 'Expired'].includes(existingAgreement.status)) {
      request.status = 'Pending';
      request.decision = undefined;
      await request.save();
      throw new ApiError(
        httpStatus.CONFLICT,
        `This partner already has agreement ${existingAgreement.agreementNo} (${existingAgreement.status}).`
      );
    }
    let agreement;
    try {
      agreement = await agreementService.createDraft({
        request,
        commission: req.body.agreement.commission,
        extraTerms: req.body.agreement.extraTerms,
        autoCountersign: req.body.agreement.autoCountersign,
        by: req.user,
      });
      agreement = await agreementService.send(agreement, {
        by: req.user,
        ip: req.ip,
        userAgent: String(req.get('user-agent') || '').slice(0, 300),
      });
    } catch (err) {
      request.status = 'Pending';
      request.decision = undefined;
      await request.save();
      if (agreement && agreement.status === 'Draft') {
        await agreementService.voidAgreement(agreement, `Sending failed: ${err.message}`, { by: req.user }).catch(() => {});
      }
      throw err instanceof ApiError ? err : new ApiError(httpStatus.BAD_REQUEST, err.message);
    }
    request.agreement = agreement._id;
    await request.save();
    return res.send({ ...request.toJSON(), agreement: agreement.toJSON() });
  }

  let user;
  try {
    user = await accessRequestService.provisionUserForRequest(request);
  } catch (err) {
    // Put the request back so the queue still shows it and the reviewer can
    // retry, rather than leaving it Approved with no account behind it. This is
    // also the path taken when the role is unconfigured, which is deliberate:
    // the server refuses to guess a role rather than falling back to the User
    // model's default, which is an ADMIN id.
    request.status = 'Pending';
    request.decision = undefined;
    await request.save();
    throw err instanceof ApiError ? err : new ApiError(httpStatus.BAD_REQUEST, err.message);
  }

  request.user = user.id;
  await request.save();

  // The applicant sets their own password through this one-time link, so no
  // credential is ever emailed. Until they follow it the account holds a random
  // password nobody has.
  try {
    await accessRequestService.sendInvite(request, user);
  } catch (err) {
    // The account exists and is sound; only the invite failed. Say so, so the
    // reviewer resends rather than assuming the partner was emailed.
    logger.error(`Access-request invite email failed: ${err.message}`);
    return res.status(httpStatus.OK).send({ ...request.toJSON(), inviteEmailFailed: true });
  }

  return res.send(request);
});

/**
 * POST /access-requests/:requestId/resend-invite  (reviewers only)
 *
 * The invite expires, and the first send can fail. Without this the only
 * recovery was the generic forgot-password flow, which mails a link to the
 * back-office host -- the wrong one for a sub-agent.
 */
const resendInvite = catchAsync(async (req, res) => {
  const request = await accessRequestService.getAccessRequestById(req.params.requestId);
  if (!request) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Access request not found');
  }
  if (request.status !== 'Approved' || !request.user) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Only an approved request with an account can be re-invited');
  }

  const user = await userService.getUserById(request.user);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'The account for this request no longer exists');
  }

  await accessRequestService.sendInvite(request, user);
  res.send({ message: `A new set-password link has been emailed to ${request.email}.` });
});

/**
 * POST /access-requests/civil-id  (public, rate-limited, multipart "file")
 *
 * Stores the scan privately and answers with a signed receipt the form sends
 * back inside the request body. Nothing is written to the database here.
 */
const uploadCivilId = catchAsync(async (req, res) => {
  const result = await accessRequestService.storeCivilIdUpload(req.file);
  res.status(httpStatus.CREATED).send(result);
});

/**
 * GET /access-requests/:requestId/civil-id  (reviewers only)
 *
 * A ten-minute read link for the scan. Issued per view and logged, because
 * this is an identity document.
 */
const civilIdLink = catchAsync(async (req, res) => {
  const request = await accessRequestService.getAccessRequestById(req.params.requestId);
  if (!request) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Access request not found');
  }
  const link = await accessRequestService.civilIdLink(request);
  logger.info(`Civil ID of access request ${request.id} viewed by ${req.user.email || req.user.id}`);
  res.send(link);
});

module.exports = {
  submitAccessRequest,
  getAccessRequests,
  decideAccessRequest,
  resendInvite,
  uploadCivilId,
  civilIdLink,
};
