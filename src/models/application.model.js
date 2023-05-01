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
  intakeYear: Number,
  intakeMonth: String,
  documents: { type: mongoose.SchemaTypes.ObjectId, ref: 'Documents' },
  course: { type: mongoose.SchemaTypes.ObjectId, ref: 'Courses', autopopulate: true },
});

module.exports = mongoose.model('Application', applicationSchema);
