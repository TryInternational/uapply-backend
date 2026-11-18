const mongoose = require('mongoose');
const httpStatus = require('http-status');
const { User, Students, Agreement, Token } = require('../models');
const config = require('../config/config');
const ApiError = require('../utils/ApiError');

/**
 * The partner directory.
 *
 * There is no Partner model in this system: a partner exists only as a USER
 * with a partner role, carrying a denormalised `organisation` string copied
 * from their access request at approval. So a "partner" here is that user,
 * and their performance is derived from the students they created.
 *
 * That constrains what can honestly be shown. The POC's cards also carry a
 * tier, a quality score and commission owed; none of those has a source in
 * this database, so they are omitted rather than invented — see the note in
 * the directory controller.
 */
const partnerRoleId = (kind) =>
  kind === 'subagent' ? config.applications.subAgentRoleId : config.applications.schoolCounselorRoleId;

const getPartnerDirectory = async (kind) => {
  const roleId = partnerRoleId(kind);
  if (!roleId || !mongoose.isValidObjectId(roleId)) return [];

  const users = await User.find({ role: roleId }).select(
    'name email organisation organisationLogo avatar createdAt partnerProfile agreement'
  );
  if (!users.length) return [];

  const ids = users.map((u) => u._id);

  // One aggregate for every partner's counts, rather than a query per partner.
  // `createdBy` is the ownership field the rest of the system scopes on, so the
  // directory and the partner's own portal always agree on whose student it is.
  const rows = await Students.aggregate([
    { $match: { createdBy: { $in: ids }, stage: { $ne: 'Denied' } } },
    {
      $group: {
        _id: '$createdBy',
        students: { $sum: 1 },
        // applied / enrolled, or lost after at least one application
        applied: {
          $sum: {
            $cond: [
              {
                $or: [
                  { $in: ['$stage', ['Applied', 'Enrolled']] },
                  { $and: [{ $eq: ['$stage', 'Lost'] }, { $gt: [{ $size: { $ifNull: ['$applications', []] } }, 0] }] },
                ],
              },
              1,
              0,
            ],
          },
        },
        // enrolled now, or in an earlier journey (a finished Foundation year)
        enrolled: {
          $sum: {
            $cond: [
              { $or: [{ $eq: ['$stage', 'Enrolled'] }, { $in: ['Enrolled', { $ifNull: ['$journeys.outcome', []] }] }] },
              1,
              0,
            ],
          },
        },
        pending: { $sum: { $cond: [{ $eq: ['$stage', 'PendingReview'] }, 1, 0] } },
      },
    },
  ]);
  const byId = new Map(rows.map((r) => [String(r._id), r]));

  return users
    .map((u) => {
      const r = byId.get(String(u._id)) || {};
      const students = r.students || 0;
      const enrolled = r.enrolled || 0;
      const pp = u.partnerProfile || {};
      return {
        id: String(u._id),
        name: u.name || 'Unknown',
        organisation: u.organisation || '',
        email: u.email || '',
        avatar: u.avatar || '',
        organisationLogo: u.organisationLogo || '',
        since: u.createdAt,
        hasAgreement: Boolean(u.agreement),
        // What the edit drawer shows; the card itself stays about performance.
        profile: {
          phoneCode: pp.phoneCode || '',
          phone: pp.phone || '',
          country: pp.country || '',
          city: pp.city || '',
          website: pp.website || '',
          socialMedia: pp.socialMedia || '',
          address: pp.address || '',
          noOffice: Boolean(pp.noOffice),
          studentsPerYear: pp.studentsPerYear || '',
          destinations: Array.isArray(pp.destinations) ? pp.destinations : [],
        },
        students,
        applied: r.applied || 0,
        enrolled,
        pending: r.pending || 0,
        // Enrolments over students sent — the POC's conversion bar.
        conversion: students ? Math.round((enrolled / students) * 100) : 0,
      };
    })
    .sort((a, b) => b.students - a.students || a.name.localeCompare(b.name));
};

/**
 * The students one partner sent.
 *
 * Scoped on `createdBy` — the same ownership field the partner's own portal is
 * scoped by — so the staff view and the partner's view can never disagree
 * about whose student a record is. Denied referrals are included here (unlike
 * the directory counts) because staff reviewing a partner's quality need to
 * see what was turned down.
 */
const getPartnerStudents = async (partnerId) => {
  if (!mongoose.isValidObjectId(partnerId)) return [];
  return Students.find({ createdBy: partnerId })
    .select('firstName lastName email phoneNo stage createdAt denialReason')
    .sort({ createdAt: -1 })
    .limit(300)
    .lean();
};

/**
 * The requestedRole name behind a directory `kind`.
 *
 * The two vocabularies exist for different reasons -- `kind` is what the
 * directory page is called, `requestedRole` is what the onboarding flow calls
 * the role -- and this is the single place they are mapped, so a caller can
 * never hand a role name straight through.
 */
const requestedRoleFor = (kind) => (kind === 'subagent' ? 'subAgent' : 'schoolCounselor');

/**
 * Set (or clear) a partner organisation's logo.
 *
 * Verifies the target really is a partner of the kind the caller named before
 * writing. Without that check this route would be a way to write an arbitrary
 * URL onto ANY user document, staff included, by passing their id.
 */
const setPartnerLogo = async (partnerId, kind, url) => {
  if (!mongoose.isValidObjectId(partnerId)) throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid partner id');
  const roleId = partnerRoleId(kind);
  if (!roleId) throw new ApiError(httpStatus.BAD_REQUEST, `No role configured for ${kind}`);

  const user = await User.findOneAndUpdate(
    { _id: partnerId, role: roleId },
    { $set: { organisationLogo: url || '' } },
    { new: true }
  ).select('name organisation organisationLogo');

  if (!user) throw new ApiError(httpStatus.NOT_FOUND, 'No such partner');
  return { id: String(user._id), organisationLogo: user.organisationLogo || '' };
};

/** Fields the edit drawer may change, and where each one lives on the user. */
const PROFILE_FIELDS = ['phoneCode', 'phone', 'country', 'city', 'website', 'socialMedia', 'address', 'studentsPerYear'];

/**
 * Edit a partner's contact details and profile.
 *
 * Scoped to a user of the kind named, like setPartnerLogo, so this can never
 * rewrite a staff account by id. The email is the login, so a change is
 * checked for clashes first; the password and role are untouchable here.
 */
const updatePartner = async (partnerId, kind, body) => {
  if (!mongoose.isValidObjectId(partnerId)) throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid partner id');
  const roleId = partnerRoleId(kind);
  if (!roleId) throw new ApiError(httpStatus.BAD_REQUEST, `No role configured for ${kind}`);
  const user = await User.findOne({ _id: partnerId, role: roleId });
  if (!user) throw new ApiError(httpStatus.NOT_FOUND, 'No such partner');

  const email = body.email ? String(body.email).trim().toLowerCase() : undefined;
  if (email && email !== user.email && (await User.isEmailTaken(email, partnerId))) {
    throw new ApiError(httpStatus.CONFLICT, `${email} already belongs to another account.`);
  }

  if (body.organisation !== undefined) user.organisation = String(body.organisation).trim();
  if (body.contact !== undefined) user.name = String(body.contact).trim();
  if (email) user.email = email;
  if (body.organisationLogo !== undefined) user.organisationLogo = body.organisationLogo || '';

  const profile = {
    ...((user.partnerProfile && user.partnerProfile.toObject && user.partnerProfile.toObject()) ||
      user.partnerProfile ||
      {}),
  };
  PROFILE_FIELDS.forEach((k) => {
    if (body[k] === undefined) return;
    const v = typeof body[k] === 'string' ? body[k].trim() : body[k];
    if (v === '' || v === null) delete profile[k];
    else profile[k] = v;
  });
  if (body.noOffice !== undefined) {
    if (body.noOffice) {
      profile.noOffice = true;
      delete profile.address;
    } else delete profile.noOffice;
  }
  if (body.destinations !== undefined) {
    const list = Array.isArray(body.destinations) ? body.destinations.map((d) => String(d).trim()).filter(Boolean) : [];
    if (list.length) profile.destinations = list;
    else delete profile.destinations;
  }
  user.partnerProfile = profile;
  user.markModified('partnerProfile');
  await user.save();

  return {
    id: String(user._id),
    name: user.name,
    organisation: user.organisation || '',
    email: user.email,
    organisationLogo: user.organisationLogo || '',
  };
};

/**
 * Remove a partner.
 *
 * What goes: the login (the user document and its tokens) and any agreement
 * still in flight, which is voided with the reason recorded. What stays: the
 * students they sent — those are Ulearn's leads and their history, and they
 * keep `createdBy` pointing at the removed id so the record of who brought
 * them is not erased — plus the completed agreements and the original access
 * request, as the paper trail. The same email can apply again afterwards.
 */
const removePartner = async (partnerId, kind, { by } = {}) => {
  if (!mongoose.isValidObjectId(partnerId)) throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid partner id');
  const roleId = partnerRoleId(kind);
  if (!roleId) throw new ApiError(httpStatus.BAD_REQUEST, `No role configured for ${kind}`);
  const user = await User.findOne({ _id: partnerId, role: roleId });
  if (!user) throw new ApiError(httpStatus.NOT_FOUND, 'No such partner');

  const students = await Students.countDocuments({ createdBy: user._id });

  const open = await Agreement.find({ user: user._id, status: { $in: ['Draft', 'Sent', 'Viewed', 'AgentSigned'] } });
  const byName = (by && by.name) || 'staff';
  await Promise.all(
    open.map((agreement) => {
      agreement.set({
        status: 'Voided',
        voidedAt: new Date(),
        voidReason: `Partner removed from the directory by ${byName}`,
        signToken: undefined,
      });
      agreement.events.push({
        type: 'voided',
        at: new Date(),
        by: by && (by.id || by._id),
        byName: by && by.name,
        note: 'partner removed',
      });
      return agreement.save();
    })
  );

  await Token.deleteMany({ user: user._id });
  await User.deleteOne({ _id: user._id });

  return {
    id: String(user._id),
    organisation: user.organisation || user.name,
    email: user.email,
    students,
    agreementsVoided: open.length,
  };
};

module.exports = { getPartnerDirectory, getPartnerStudents, requestedRoleFor, setPartnerLogo, updatePartner, removePartner };
