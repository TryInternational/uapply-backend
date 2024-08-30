const mongoose = require('mongoose');

const { Schema } = mongoose;

const applicationSchema = new Schema(
  {
    startDate: Date,
    endDate: Date,
    campus: {
      name: String,
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
    managedBy: String,
    intakeYear: Number,
    courseName: String,
    intakeMonth: String,
    finalChoice: Boolean,
    documents: { type: mongoose.SchemaTypes.ObjectId, ref: 'Documents' },
    course: { type: mongoose.SchemaTypes.ObjectId, ref: 'Courses', autopopulate: true },
    institute: Object,
    rejected: Boolean,
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

module.exports = mongoose.model('Application', applicationSchema);
