const mongoose = require('mongoose');
const { toJSON, paginate } = require('./plugins');

/**
 * A sub-agent agreement: one per partner, generated from the agreement
 * template with the deal the reviewer sets (percentage of first-year tuition
 * or a fixed amount per student, plus any extra terms), sent for electronic
 * signature, countersigned by Ulearn and kept as a PDF with its audit trail.
 *
 * Lifecycle
 *   Draft → Sent → Viewed → AgentSigned → Completed
 *                   ↘ Declined        ↘ (Voided / Expired at any point before Completed)
 *
 * The signing link is a random token; only its SHA-256 is stored here, so a
 * read of this collection cannot be turned into a way to sign for someone.
 * Signature images and PDFs live in the storage bucket under unguessable paths
 * and are never public — reviewers get short-lived signed URLs.
 */

const STATUSES = ['Draft', 'Sent', 'Viewed', 'AgentSigned', 'Completed', 'Declined', 'Voided', 'Expired'];
const COMMISSION_TYPES = ['percentage', 'fixed'];
const EVENT_TYPES = [
  'created',
  'sent',
  'resent',
  'viewed',
  'agent_signed',
  'agent_declined',
  'countersigned',
  'completed',
  'voided',
  'expired',
  'reminder_sent',
  'invite_sent',
];

const signatureSchema = new mongoose.Schema(
  {
    // Object path of the PNG in the bucket (private).
    imagePath: { type: String, trim: true },
    // 'drawn' on a signature pad, 'typed' (name rendered in a script face),
    // 'stored' (the company signatory's signature on file).
    method: { type: String, enum: ['drawn', 'typed', 'stored'] },
    typedName: { type: String, trim: true },
    signedAt: { type: Date },
    ip: { type: String, trim: true },
    userAgent: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    // Who applied the company signature (a staff user), for the countersign.
    by: { type: mongoose.SchemaTypes.ObjectId, ref: 'User' },
    byName: { type: String, trim: true },
    // The exact consent sentence the signer ticked, kept with the signature.
    consentText: { type: String, trim: true },
  },
  { _id: false }
);

const eventSchema = new mongoose.Schema(
  {
    type: { type: String, enum: EVENT_TYPES, required: true },
    at: { type: Date, default: Date.now },
    ip: { type: String, trim: true },
    userAgent: { type: String, trim: true },
    by: { type: mongoose.SchemaTypes.ObjectId, ref: 'User' },
    byName: { type: String, trim: true },
    note: { type: String, trim: true },
  },
  { _id: false }
);

const agreementSchema = new mongoose.Schema(
  {
    // UL-SA-2026-0001 — allocated when the draft is created, never reused.
    agreementNo: { type: String, required: true, unique: true, trim: true },
    kind: { type: String, enum: ['subAgent'], default: 'subAgent' },
    templateVersion: { type: String, required: true, trim: true },

    accessRequest: { type: mongoose.SchemaTypes.ObjectId, ref: 'AccessRequest' },
    // The partner's account, set once the agreement is completed and the
    // portal account exists (or straight away for a partner who already has one).
    user: { type: mongoose.SchemaTypes.ObjectId, ref: 'User' },

    // The Second Party as printed. Copied from the access request at draft
    // time so later edits to the request do not silently change a contract.
    agent: {
      nameEn: { type: String, trim: true, required: true },
      nameAr: { type: String, trim: true },
      civilId: { type: String, trim: true },
      mobile: { type: String, trim: true },
      // Where the signing link goes.
      email: { type: String, trim: true, lowercase: true, required: true },
      // The account holder's address when it differs from the signer's.
      accountEmail: { type: String, trim: true, lowercase: true },
      organisationEn: { type: String, trim: true },
      organisationAr: { type: String, trim: true },
    },

    // The deal. `textEn`/`textAr` are the rendered sentences, kept so the PDF
    // and the screen always say exactly the same thing.
    commission: {
      type: { type: String, enum: COMMISSION_TYPES, required: true },
      value: { type: Number, required: true, min: 0 },
      // Fixed amounts only (ISO code).
      currency: { type: String, trim: true, uppercase: true },
      textEn: { type: String, trim: true },
      textAr: { type: String, trim: true },
    },
    // "Rules and regulations" specific to this partner, printed as section 6.
    extraTerms: {
      type: [
        new mongoose.Schema(
          {
            en: { type: String, trim: true, required: true },
            ar: { type: String, trim: true },
          },
          { _id: false }
        ),
      ],
      default: [],
    },

    status: { type: String, enum: STATUSES, default: 'Draft' },
    // Date sent = start date of the one-year term.
    agreementDate: { type: Date },
    sentAt: { type: Date },
    viewedAt: { type: Date },
    agentSignedAt: { type: Date },
    countersignedAt: { type: Date },
    completedAt: { type: Date },
    voidedAt: { type: Date },
    expiresAt: { type: Date },

    // Apply the stored company signature the moment the agent signs, so the
    // partner gets the countersigned copy and their portal invite without
    // waiting for someone in the office. Off → a reviewer countersigns by hand.
    autoCountersign: { type: Boolean, default: true },

    // The signing link. Only the hash is kept.
    signToken: {
      hash: { type: String, trim: true },
      // The token itself, AES-256-GCM under the server secret, so reminder
      // emails can carry the SAME link the partner already has. Never in JSON.
      enc: { type: String, trim: true },
      expiresAt: { type: Date },
    },

    signatures: {
      agent: { type: signatureSchema },
      company: { type: signatureSchema },
    },

    // SHA-256 of the unsigned PDF exactly as emailed for signature.
    documentHash: { type: String, trim: true },
    // The completed PDF (both signatures + certificate page).
    pdf: {
      path: { type: String, trim: true },
      sha256: { type: String, trim: true },
      pages: { type: Number },
      bytes: { type: Number },
      generatedAt: { type: Date },
    },

    events: { type: [eventSchema], default: [] },

    declineReason: { type: String, trim: true },
    voidReason: { type: String, trim: true },
    remindersSent: { type: Number, default: 0 },
    lastReminderAt: { type: Date },

    createdBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User' },
    createdByName: { type: String, trim: true },
  },
  {
    timestamps: true,
    toJSON: {
      transform(doc, ret) {
        /* eslint-disable no-param-reassign */
        ret.createdAt = doc.createdAt;
        ret.updatedAt = doc.updatedAt;
        // Never hand out the token hash or storage paths; links are issued
        // separately and expire.
        delete ret.signToken;
        if (ret.signatures) {
          ['agent', 'company'].forEach((k) => {
            if (ret.signatures[k]) {
              ret.signatures[k] = { ...ret.signatures[k], hasImage: Boolean(ret.signatures[k].imagePath) };
              delete ret.signatures[k].imagePath;
            }
          });
        }
        if (ret.pdf) {
          ret.pdf = {
            ready: Boolean(ret.pdf.path),
            sha256: ret.pdf.sha256,
            pages: ret.pdf.pages,
            bytes: ret.pdf.bytes,
            generatedAt: ret.pdf.generatedAt,
          };
        }
        /* eslint-enable no-param-reassign */
      },
    },
  }
);

agreementSchema.plugin(toJSON);
agreementSchema.plugin(paginate);

agreementSchema.index({ status: 1, createdAt: -1 });
agreementSchema.index({ accessRequest: 1 });
agreementSchema.index({ user: 1 });
agreementSchema.index({ 'signToken.hash': 1 });

const Agreement = mongoose.model('Agreement', agreementSchema);

module.exports = Agreement;
module.exports.STATUSES = STATUSES;
module.exports.COMMISSION_TYPES = COMMISSION_TYPES;
module.exports.EVENT_TYPES = EVENT_TYPES;
