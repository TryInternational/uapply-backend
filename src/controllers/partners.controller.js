const httpStatus = require('http-status');
const logger = require('../config/logger');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');
const { partnersService, accessRequestService, userService } = require('../services');

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
      name: req.body.contact,
      email,
      phoneCode: req.body.phoneCode,
      phone: req.body.phone,
      organisation: req.body.organisation,
      country: req.body.country,
      city: req.body.city,
      website: req.body.website,
      note: req.body.note,
    },
    {
      organisationLogo: req.body.organisationLogo,
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

module.exports = { getDirectory, getPartnerStudents, createPartner, updateLogo };
