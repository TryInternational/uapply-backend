const httpStatus = require('http-status');
const logger = require('../config/logger');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');
const { partnersService, accessRequestService, userService, agreementService } = require('../services');

/**
 * GET /partners/directory?kind=subagent|counselor
 *
 * Staff-only (enforced on the route). Returns one row per partner user with
 * the counts derived from the students they created.
 *
 * Deliberately omits the POC card's tier, quality score and commission owed:
 * this database has no partner record to hang them on, and a fabricated
 * quality score on a page about partner performance is worse than an absent
 * one. See partners.service for the shape that IS backed by real data.
 */
const getDirectory = catchAsync(async (req, res) => {
  const kind = req.query.kind === 'subagent' ? 'subagent' : 'counselor';
  res.send(await partnersService.getPartnerDirectory(kind));
});

const getPartnerStudents = catchAsync(async (req, res) => {
  res.send(await partnersService.getPartnerStudents(req.params.partnerId));
});

/**
 * POST /partners  (reviewers only)
 *
 * Staff adding a partner directly, rather than waiting for that partner to
 * apply through the public form.
 *
 * It deliberately runs through the SAME machinery as an approved request: an
 * AccessRequest row is written first (status Approved, the decision stamped
 * with the staff member who did it), then provisionUserForRequest creates the
 * account, then the shared invite goes out. Three reasons, in order of how much
 * they would have cost to get wrong:
 *
 *   1. Role assignment. provisionUserForRequest resolves the role through
 *      roleIdForRequestedRole, which throws on a miss. A hand-rolled create
 *      here would fall through to the User model's default role -- an ADMIN id
 *      -- and hand an external partner the back office.
 *   2. The password. Nothing here sets one; the partner sets their own through
 *      the one-time link, so no credential is created or emailed.
 *   3. Provenance. The directory, the review queue and the partner's own record
 *      all read one row, so "where did this partner come from" has a single
 *      answer whether they applied or were added.
 */
const createPartner = catchAsync(async (req, res) => {
  const kind = req.body.kind === 'subagent' ? 'subagent' : 'counselor';
  const requestedRole = partnersService.requestedRoleFor(kind);
  const email = String(req.body.email || '')
    .trim()
    .toLowerCase();
  // Full form (the sub-agent drawer) or short form (the school drawer).
  const name = req.body.name || req.body.contact;
  // Upload receipts, verified before anything is written — same as the public form.
  const civilId = req.body.civilIdUpload ? accessRequestService.verifyCivilIdReceipt(req.body.civilIdUpload) : undefined;
  const logo = req.body.logoUpload ? accessRequestService.verifyCivilIdReceipt(req.body.logoUpload, 'logo') : undefined;
  const wantsAgreement = kind === 'subagent' && !req.body.skipAgreement && Boolean(req.body.agreement);

  // Checked before anything is written. createUser would refuse the duplicate
  // anyway, but only after the AccessRequest row existed -- leaving an Approved
  // request with no account behind it, which is exactly the state the approval
  // path takes such care to avoid.
  if (await userService.getUserByEmail(email)) {
    throw new ApiError(
      httpStatus.CONFLICT,
      `${email} already has an account. Ask them to sign in, or use Forgot password — adding cannot create a second one.`
    );
  }

  const actor = req.user || {};
  const request = await accessRequestService.createAccessRequest(
    {
      requestedRole,
      name,
      email,
      phoneCode: req.body.phoneCode,
      phone: req.body.phone,
      organisation: req.body.organisation,
      country: req.body.country,
      city: req.body.city,
      website: req.body.website,
      note: req.body.note,
      title: req.body.title,
      nameAr: req.body.nameAr,
      organisationAr: req.body.organisationAr,
      organisationDetails:
        req.body.organisationDetails || (req.body.socialMedia ? { socialMedia: req.body.socialMedia } : undefined),
      personInCharge: req.body.personInCharge,
    },
    {
      organisationLogo: req.body.organisationLogo,
      civilId,
      logo,
      createdByStaff: true,
      status: 'Approved',
      decision: {
        by: actor.id || actor._id,
        byName: actor.name,
        at: new Date(),
        reason: 'Added directly from the partner directory',
      },
    }
  );

  // ---- sub-agent with a deal: the agreement goes first ----------------------
  // Identical to approving a request: nothing is provisioned until the
  // agreement comes back signed (agreementService.complete does that). If
  // sending fails the row we just made goes too — it was ours, a moment ago.
  if (wantsAgreement) {
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
      if (agreement && agreement.status === 'Draft') {
        await agreementService.voidAgreement(agreement, `Sending failed: ${err.message}`, { by: req.user }).catch(() => {});
      }
      await request.deleteOne();
      throw err instanceof ApiError ? err : new ApiError(httpStatus.BAD_REQUEST, err.message);
    }
    request.agreement = agreement._id;
    await request.save();
    return res.status(httpStatus.CREATED).send({ requestId: request.id, agreement: agreement.toJSON() });
  }

  let user;
  try {
    user = await accessRequestService.provisionUserForRequest(request);
  } catch (err) {
    // Nothing half-made is left behind: no account was created, so the row that
    // claims one exists goes too. (The approval path instead returns the
    // request to the queue -- there it is the applicant's own submission and
    // must survive; here the row was ours, made a moment ago.)
    await request.deleteOne();
    throw err instanceof ApiError ? err : new ApiError(httpStatus.BAD_REQUEST, err.message);
  }

  request.user = user.id;
  await request.save();

  try {
    await accessRequestService.sendInvite(request, user);
  } catch (err) {
    // The account is sound; only the mail failed. Say which, so staff resend
    // from the review queue rather than assuming the partner was emailed.
    logger.error(`Partner invite email failed: ${err.message}`);
    return res.status(httpStatus.CREATED).send({ id: user.id, inviteEmailFailed: true });
  }

  return res.status(httpStatus.CREATED).send({ id: user.id });
});

/**
 * PATCH /partners/:partnerId/logo  (reviewers only)
 *
 * The URL of an already-uploaded file. The upload itself happens in the
 * browser against storage, as every other file in this system does, so no
 * bytes pass through here.
 */
const updateLogo = catchAsync(async (req, res) => {
  const kind = req.body.kind === 'subagent' ? 'subagent' : 'counselor';
  res.send(await partnersService.setPartnerLogo(req.params.partnerId, kind, req.body.organisationLogo));
});

/** PATCH /partners/:partnerId  (reviewers only) — the edit drawer. */
const updatePartner = catchAsync(async (req, res) => {
  const kind = req.body.kind === 'subagent' ? 'subagent' : 'counselor';
  res.send(await partnersService.updatePartner(req.params.partnerId, kind, req.body));
});

/**
 * DELETE /partners/:partnerId?kind=  (admins only)
 *
 * Admins rather than reviewers: approving someone is reversible by removing
 * them, but removing them is not reversible by anything short of re-adding.
 */
const removePartner = catchAsync(async (req, res) => {
  const kind = req.query.kind === 'subagent' ? 'subagent' : 'counselor';
  const result = await partnersService.removePartner(req.params.partnerId, kind, { by: req.user });
  logger.info(`partner ${result.email} (${result.organisation}) removed by ${req.user && req.user.email}`);
  res.send(result);
});

module.exports = { getDirectory, getPartnerStudents, createPartner, updateLogo, updatePartner, removePartner };
