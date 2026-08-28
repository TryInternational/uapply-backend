const mongoose = require('mongoose');
const httpStatus = require('http-status');
const { User, Students } = require('../models');
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

  const users = await User.find({ role: roleId }).select('name email organisation organisationLogo avatar createdAt');
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
        applied: { $sum: { $cond: [{ $in: ['$stage', ['Applied', 'Enrolled']] }, 1, 0] } },
        enrolled: { $sum: { $cond: [{ $eq: ['$stage', 'Enrolled'] }, 1, 0] } },
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
      return {
        id: String(u._id),
        name: u.name || 'Unknown',
        organisation: u.organisation || '',
        email: u.email || '',
        avatar: u.avatar || '',
        organisationLogo: u.organisationLogo || '',
        since: u.createdAt,
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

module.exports = { getPartnerDirectory, getPartnerStudents, requestedRoleFor, setPartnerLogo };
