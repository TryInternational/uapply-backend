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
    // The same name in Arabic -- partner paperwork in Kuwait is bilingual, and
    // the reviewer matches the request against Arabic-language documents.
    nameAr: { type: String, trim: true },
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
    organisationAr: { type: String, trim: true },
    country: { type: String, trim: true },
    city: { type: String, trim: true },
    website: { type: String, trim: true },
    // "Tell us about your students" -- the free-text a reviewer actually reads.
    note: { type: String, trim: true },

    // ---- Who is asking, in more detail -------------------------------------
    // The applicant's own position at the organisation ("Director", "Senior
    // counsellor"). `name`/`email`/`phone` above remain the applicant.
    title: { type: String, trim: true },

    // The organisation behind the request. `organisation` above stays the name
    // the partner trades under (what the directory and the portal show); this
    // is everything a reviewer needs to check that the agency is real.
    organisationDetails: {
      // Registered company name when it differs from the trading name.
      legalName: { type: String, trim: true },
      yearEstablished: { type: Number, min: 1900, max: 2100 },
      // Street address; country and city live on the row above.
      address: { type: String, trim: true },
      // No office -- works online / from home.
      noOffice: { type: Boolean },
      // Size bands rather than exact numbers -- nobody knows the exact count.
      staffCount: { type: String, enum: ['1-5', '6-20', '21-50', '50+'] },
      studentsPerYear: { type: String, enum: ['<25', '25-100', '100+', '100-500', '500+'] },
      // Countries their students usually go to.
      destinations: { type: [String], default: undefined },
      services: { type: String, trim: true },
      socialMedia: { type: String, trim: true },
    },

    // The person legally responsible for the organisation -- the owner or
    // licence holder whose Civil ID is uploaded below. Often the applicant.
    personInCharge: {
      name: { type: String, trim: true },
      nameAr: { type: String, trim: true },
      title: { type: String, trim: true },
      email: { type: String, trim: true, lowercase: true },
      phoneCode: { type: String, trim: true },
      phone: { type: String, trim: true },
      civilIdNumber: { type: String, trim: true },
      sameAsApplicant: { type: Boolean, default: false },
    },

    // The Civil ID scan. The FILE sits in the storage bucket under an
    // unguessable path and is never public: reviewers fetch a short-lived
    // signed link through GET /access-requests/:id/civil-id. The path is
    // removed from JSON below so the list endpoint never hands it out.
    civilId: {
      path: { type: String, trim: true },
      fileName: { type: String, trim: true },
      contentType: { type: String, trim: true },
      size: { type: Number },
      uploadedAt: { type: Date },
    },
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
    // Sub-agents: the agreement sent at approval. The account is only
    // provisioned once it is signed by both parties.
    agreement: { type: mongoose.SchemaTypes.ObjectId, ref: 'Agreement' },

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
        if (ret.civilId) {
          // The reviewer screen only needs to know a scan exists; the link to
          // it is a separate, authenticated call that expires.
          // eslint-disable-next-line no-param-reassign
          ret.civilId = {
            uploaded: Boolean(ret.civilId.path),
            fileName: ret.civilId.fileName,
            contentType: ret.civilId.contentType,
            size: ret.civilId.size,
            uploadedAt: ret.civilId.uploadedAt,
          };
        }
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
