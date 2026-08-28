const mongoose = require('mongoose');
const validator = require('validator');
const { toJSON, paginate } = require('./plugins');

/**
 * A request from an EXTERNAL party to be given portal access.
 *
 * Deliberately NOT a User. Nothing here can sign in: the request is inert data
 * until a reviewer approves it, at which point a User is created with a role
 * the server chooses. Keeping the two apart means a rejected or abandoned
 * request never leaves a credential behind, and the public endpoint that writes
 * this collection can never touch the users collection.
 */

// The only roles that can be REQUESTED. Internal roles are absent by design --
// the request body names one of these two keys, never a role id, so there is no
// value a caller can send that maps to an admin or counsellor.
const REQUESTABLE_ROLES = ['subAgent', 'schoolCounselor'];

const REQUEST_STATUSES = ['Pending', 'Approved', 'Declined'];

const accessRequestSchema = mongoose.Schema(
  {
    requestedRole: {
      type: String,
      enum: REQUESTABLE_ROLES,
      required: true,
    },
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      validate(value) {
        if (!validator.isEmail(value)) {
          throw new Error('Invalid email');
        }
      },
    },
    // Split so the country code stays selectable in the form and the number
    // remains searchable on its own.
    phoneCode: { type: String, trim: true },
    phone: { type: String, required: true, trim: true },
    // Agency name for a sub-agent, school name for a school counsellor.
    organisation: { type: String, required: true, trim: true },
    country: { type: String, trim: true },
    city: { type: String, trim: true },
    website: { type: String, trim: true },
    // "Tell us about your students" -- the free-text a reviewer actually reads.
    note: { type: String, trim: true },
    // Set only on the staff-created path (Partners -> Add sub-agent / Add
    // school), where the admin uploads the organisation's logo as they type the
    // rest. Absent from PUBLIC_FIELDS in the service, so the public form cannot
    // set it -- an unauthenticated caller must not be able to put an arbitrary
    // URL on a row a reviewer will look at.
    organisationLogo: { type: String, trim: true },

    // True when an admin added this partner directly rather than the partner
    // applying. The row still exists in both cases: it is what carries the
    // organisation, the decision and the link to the account, and it keeps one
    // audit trail for "where did this partner come from" instead of two.
    createdByStaff: { type: Boolean, default: false },

    status: {
      type: String,
      enum: REQUEST_STATUSES,
      default: 'Pending',
    },
    // Set on approval. The link back to the account this request produced.
    user: { type: mongoose.SchemaTypes.ObjectId, ref: 'User' },

    // Set when the submitting email already belongs to a User. The row is still
    // created (see the controller) so the request leaves a trace and a reviewer
    // can see it, rather than vanishing into a cheerful acknowledgement.
    existingAccount: { type: Boolean, default: false },

    // Snapshot of the last decision on this email, copied forward when someone
    // resubmits. Without it a declined applicant reappears on the In review tab
    // looking brand new, with the earlier decision sitting on another tab.
    previousStatus: { type: String, enum: ['Approved', 'Declined'] },
    previousReason: { type: String, trim: true },

    decision: {
      by: { type: mongoose.SchemaTypes.ObjectId, ref: 'User' },
      byName: String,
      at: Date,
      // Required by the controller when declining.
      reason: String,
    },
  },
  {
    timestamps: true,
    // The shared toJSON plugin strips createdAt/updatedAt, but the reviewer
    // queue sorts and labels by submitted date -- re-add it here, the same way
    // note.model.js does. The plugin chains this transform after its own.
    toJSON: {
      transform(doc, ret) {
        // eslint-disable-next-line no-param-reassign
        ret.createdAt = doc.createdAt;
      },
    },
  }
);

accessRequestSchema.plugin(toJSON);
accessRequestSchema.plugin(paginate);

// The reviewer queue reads status + newest-first; the duplicate check on the
// public endpoint reads email + status.
accessRequestSchema.index({ status: 1, createdAt: -1 });
accessRequestSchema.index({ email: 1, status: 1 });

const AccessRequest = mongoose.model('AccessRequest', accessRequestSchema);

module.exports = AccessRequest;
module.exports.REQUESTABLE_ROLES = REQUESTABLE_ROLES;
module.exports.REQUEST_STATUSES = REQUEST_STATUSES;
