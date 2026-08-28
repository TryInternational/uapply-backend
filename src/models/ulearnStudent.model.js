const mongoose = require('mongoose');
const { toJSON, paginate } = require('./plugins');

/**
 * UlearnStudent — the ulearn test-taker identity.
 *
 * Deliberately SEPARATE from students.model.js: that model is uapply's
 * application/CRM entity (sponsorship, course selections, password auth via
 * passport) with a different product lifecycle. This model is a lean
 * Google-authenticated identity whose job is to tie IELTS / aptitude / major
 * attempts together and expose progress.
 *
 * Design choices:
 *  - Test history lives in the three test collections as the SOURCE OF TRUTH
 *    (each gains an optional indexed studentId). attemptsSummary here is only
 *    a small read cache for dashboards — full progress is always derived from
 *    the referenced documents so it can never drift.
 *  - IDENTITY IS THE FIREBASE-VERIFIED PHONE NUMBER. `phone` holds E.164 and is
 *    only trusted when `phoneVerified` is true, which happens exactly once: in
 *    the phone auth handler, from a Firebase ID token payload. Nothing
 *    client-supplied ever reaches it, and PATCH /me cannot write it.
 *  - email is now OPTIONAL and, unless `emailVerified` is true, is just a
 *    profile field a student typed into a test form. Claiming by email is
 *    therefore gated on emailVerified — see the service.
 *  - googleId/email keep PARTIAL unique indexes rather than `unique: true`, so
 *    the many phone-only accounts (which have neither) do not all collide on a
 *    single null value.
 */
const ulearnStudentSchema = mongoose.Schema(
  {
    // ── identity: Firebase phone (primary) ──
    firebaseUid: {
      // Firebase's stable `uid` — survives the student changing their number
      type: String,
      trim: true,
    },
    phoneVerified: {
      // true only when `phone` came from a verified Firebase phone token
      type: Boolean,
      default: false,
    },
    phoneDialCode: {
      // country calling code without "+", e.g. "965" — split out so the
      // ambiguity guard in claiming can compare national parts across countries
      type: String,
      trim: true,
    },
    phoneNational: {
      // subscriber digits after the dial code, e.g. "55001122"
      type: String,
      trim: true,
      index: true,
    },
    authProvider: {
      type: String,
      enum: ['phone', 'google'],
      default: 'phone',
    },

    // ── identity: Google (legacy, retained for rollback — see config
    //    ulearnStudents.googleAuthEnabled) ──
    googleId: {
      // Google's stable `sub` claim — survives the user changing their email
      type: String,
      trim: true,
    },
    email: {
      // Google-verified when emailVerified is true; otherwise a profile field
      // the student typed into a test form. Lowercase for exact claim matching.
      type: String,
      trim: true,
      lowercase: true,
    },
    emailVerified: {
      // ONLY a provider-verified email may be used to claim attempts.
      // Defaults to false now that most accounts authenticate by phone.
      type: Boolean,
      default: false,
    },
    name: {
      type: String,
      trim: true,
    },
    avatar: {
      // provider profile picture URL
      type: String,
    },

    // ── profile: mirrors what the tests already collect, so data from
    //    claimed attempts merges cleanly and forms don't re-ask ──
    phone: { type: String, trim: true }, // E.164 with "+" once verified
    dob: { type: Date },
    nationality: { type: Object }, // tests store string OR {english_name,...}
    destination: { type: String },
    studyLevel: { type: String }, // IELTS "purpose of the test" (study/work/…)
    targetScore: { type: Number, min: 0, max: 9 }, // IELTS target from onboarding

    // ── durable answers collected by the test onboarding flows. All optional:
    //    a student only ever fills the ones their chosen tests ask for, and
    //    every one of them is asked at most once (fill-once profile).
    degree: { type: String }, // degree sought — aptitude + major onboarding
    previousSchool: { type: String }, // last school / university attended
    cgpa: { type: String }, // GPA or percentage, free-form by design
    englishProficiency: {
      // "have you taken IELTS/TOEFL?" → a score, else a self-rated level
      hasTest: { type: Boolean },
      score: { type: String },
      level: { type: String },
    },

    // ── test linkage: small summary for fast dashboard reads.
    //    refId points at the authoritative test document. ──
    attemptsSummary: [
      {
        testType: {
          type: String,
          enum: ['ielts', 'aptitude', 'major'],
          required: true,
        },
        refId: {
          type: mongoose.SchemaTypes.ObjectId,
          required: true,
        },
        takenAt: { type: Date },
        headline: { type: Object }, // per-type headline scores (see service)
      },
    ],

    // ── metadata ──
    // ── attempt rollup: denormalised so the back-office list can sort and
    //    paginate on a single indexed field.
    //
    //    "most recent attempt first" is a property of THREE OTHER collections,
    //    so it cannot be a plain sort on this one. The alternative — a
    //    $unionWith aggregation across ielts/aptitude/major — cannot use the
    //    shared paginate plugin and degrades as those collections grow.
    //
    //    These fields are RECOMPUTED from the source collections after every
    //    write (see refreshAttemptRollup), never incremented, so they cannot
    //    drift out of step the way a counter would.
    lastAttemptAt: { type: Date, index: true },
    lastAttempt: {
      testType: { type: String, enum: ['ielts', 'aptitude', 'major'] },
      takenAt: { type: Date },
      headline: { type: Object },
    },
    attemptCounts: {
      ielts: { type: Number, default: 0 },
      aptitude: { type: Number, default: 0 },
      major: { type: Number, default: 0 },
      total: { type: Number, default: 0 },
    },

    // ── CRM pipeline status. Mirrors leads.model.js so a counsellor reads the
    //    same vocabulary in both lists. Note the spelling: the leads enum and
    //    the CRM's pill logic both use "Sent Whatsapp" (lowercase a), so this
    //    matches that rather than the more usual "Sent WhatsApp".
    status: {
      type: String,
      enum: ['New', 'Sent Whatsapp', 'Converted'],
      default: 'New',
      index: true,
    },

    lastLoginAt: { type: Date },
    claimedAt: { type: Date }, // when historical attempts were claimed
    // audit trail for claiming: how many attempts were linked on the weaker
    // "national digits only" basis, so a disputed claim can be investigated
    claimAudit: [
      {
        testType: { type: String, enum: ['ielts', 'aptitude', 'major'] },
        refId: { type: mongoose.SchemaTypes.ObjectId },
        basis: { type: String, enum: ['email', 'exact', 'national'] },
        at: { type: Date, default: Date.now },
      },
    ],
    consent: {
      marketing: { type: Boolean, default: false },
    },
    role: {
      type: String,
      default: 'ulearn-student',
    },
  },
  {
    timestamps: true,
  }
);

// compound index: history reads sort the summary newest-first per student
ulearnStudentSchema.index({ 'attemptsSummary.takenAt': -1 });

// the back-office list's default order: most recent attempt first, with
// students who have never taken a test (lastAttemptAt unset) sorting last
ulearnStudentSchema.index({ lastAttemptAt: -1, createdAt: -1 });

/* ---------------------------------------------------------------- indexes --
 * PARTIAL uniqueness, not `unique: true`.
 *
 * A plain unique index treats every document missing the field as holding the
 * same `null`, so the second phone-only account (no googleId, no email) would
 * be rejected as a duplicate. Partial filters restrict the constraint to
 * documents where the field is actually a string, which is what we mean.
 *
 * `phone` is constrained only where phoneVerified is true. Existing rows carry
 * a free-form, self-typed phone from profile sync; those are deliberately left
 * unconstrained so this index can be built on the live collection without
 * colliding on legacy duplicates.
 */
ulearnStudentSchema.index(
  { firebaseUid: 1 },
  { unique: true, partialFilterExpression: { firebaseUid: { $type: 'string' } } }
);
ulearnStudentSchema.index(
  { phone: 1 },
  { unique: true, partialFilterExpression: { phoneVerified: true } }
);
ulearnStudentSchema.index(
  { googleId: 1 },
  { unique: true, partialFilterExpression: { googleId: { $type: 'string' } } }
);
ulearnStudentSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { email: { $type: 'string' } } }
);

// add plugin that converts mongoose to json
ulearnStudentSchema.plugin(toJSON);
ulearnStudentSchema.plugin(paginate);

/**
 * @typedef UlearnStudent
 */
const UlearnStudent = mongoose.model('UlearnStudent', ulearnStudentSchema);

module.exports = UlearnStudent;
