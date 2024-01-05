const mongoose = require('mongoose');

const { Schema } = mongoose;

const applicationSchema = new Schema({
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
  intakeMonth: String,
  documents: { type: mongoose.SchemaTypes.ObjectId, ref: 'Documents' },
  course: { type: mongoose.SchemaTypes.ObjectId, ref: 'Courses', autopopulate: true },
  institute: Object,
  status: {
    type: [String],
    enum: ['Status 1', 'Status 2', 'Status 3', 'Status 4', 'Status 5'],
    default: 'Status 1',
  },
});

module.exports = mongoose.model('Application', applicationSchema);
