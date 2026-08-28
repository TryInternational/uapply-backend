const mongoose = require('mongoose');

const { Schema } = mongoose;

const applicationSchema = new Schema(
  {
    startDate: Date,
    endDate: Date,
    campus: {
      name: String,
    },
    agent: {
      type: String,
      enum: ['Ulearn', 'SIUK', 'GESCO'],
    },
    comments: { type: String },
    bachelorYear: {
      type: String,
      enum: ['First Year', 'Second Year', ''],
    },
    applicationId: String,
    studentId: { type: mongoose.SchemaTypes.ObjectId, ref: 'Students' },
    portalApplicationStatus: {
      applicationPhases: [
        {
          status: String,
          phaseState: String,
          isCurrent: Boolean,
          isPrevious: Boolean,
          createdDate: Date,
          updatedDate: Date,
          subApplicationPhase: [
            {
              statusDescription: String,
              documents: { type: mongoose.SchemaTypes.ObjectId, ref: 'Documents' },
            },
          ],
          closedStatus: String,
          offerStatus: String,
        },
      ],
    },
    courseLevel: String,
    provider: String,
    managedBy: String,
    intakeYear: Number,
    courseName: String,
    intakeMonth: String,
    finalChoice: Boolean,
    documents: { type: mongoose.SchemaTypes.ObjectId, ref: 'Documents' },
    course: { type: mongoose.SchemaTypes.ObjectId, ref: 'Courses', autopopulate: true },
    institute: Object,
    rejected: Boolean,
    // ---- Sub-agent submission / counsellor approval ----
    // Who created this application. Set SERVER-SIDE from the authenticated
    // user; never trusted from the request body, because it is the ownership
    // boundary a sub-agent is scoped by.
    createdBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User' },
    // Role of the creator at creation time, kept so a later role change does
    // not retroactively reclassify an application.
    createdByRole: { type: mongoose.SchemaTypes.ObjectId, ref: 'Role' },
    // Approval gate that sits IN FRONT of portalApplicationStatus. Staff-created
    // applications default to APPROVED so the existing pipeline is untouched;
    // only sub-agent submissions ever enter SUBMITTED_BY_SUBAGENT.
    reviewStatus: {
      type: String,
      // SUBMITTED_BY_COUNSELOR is distinct from SUBMITTED_BY_SUBAGENT on purpose:
      // both are partner submissions awaiting review, but the reviewer queue and
      // the notification wording need to say WHICH partner sent it, and a single
      // shared value would make sub-agent and school-counsellor volume
      // indistinguishable in reporting.
      enum: [
        'DRAFT',
        'SUBMITTED_BY_SUBAGENT',
        'SUBMITTED_BY_COUNSELOR',
        'APPROVED',
        'REJECTED',
        'RETURNED_FOR_EDIT',
      ],
      default: 'APPROVED',
    },
    // Append-only decision log: every approve / reject / return, with actor,
    // timestamp and note. Never rewritten, only pushed to.
    reviewHistory: [
      {
        action: {
          type: String,
          enum: ['SUBMITTED', 'RESUBMITTED', 'APPROVED', 'REJECTED', 'RETURNED_FOR_EDIT'],
        },
        by: { type: mongoose.SchemaTypes.ObjectId, ref: 'User' },
        byName: String,
        note: String,
        at: { type: Date, default: Date.now },
      },
    ],
    status: {
      type: [String],
      enum: ['Offer on KCO', 'KCO Approved', 'Status 3'],
      default: 'Status 3',
    },
  },
  {
    timestamps: true,
  }
);

// Performance indexes — applications are fetched per student and by date.
applicationSchema.index({ studentId: 1 });
applicationSchema.index({ createdAt: -1 });
// Sub-agent portal lists a single agent's own applications; the counsellor
// queue lists everything awaiting review. Both must be index-served -- the
// ownership filter runs in the QUERY, so without these it is a collection scan
// on every portal page load.
applicationSchema.index({ createdBy: 1, createdAt: -1 });
applicationSchema.index({ reviewStatus: 1, createdAt: -1 });

module.exports = mongoose.model('Application', applicationSchema);
