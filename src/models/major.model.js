const mongoose = require('mongoose');
const { toJSON, paginate, slug, populate } = require('./plugins');

const majorSchema = mongoose.Schema(
  {
    studentId: {
      // optional link to the UlearnStudent who took this attempt (additive:
      // anonymous submissions leave it null). Indexed for history/progress.
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'UlearnStudent',
      default: null,
      index: true,
    },
    name: {
      type: String,
    },
    phoneNo: {
      type: String,
    },
    countryCode: {
      type: String,
    },
    dob: {
      type: Date,
    },
    degree: { type: String },
    cgpa: {
      type: String,
    },
    previousSchool: {
      type: String,
    },
    englishProficiency: {
      type: Object,
    },

    destination: {
      type: String,
    },
    nationality: {
      type: String,
    },
    source: {
      type: String,
    },
    medium: {
      type: String,
    },
    campaign: {
      type: String,
    },
    content: {
      type: String,
    },
    email: {
      type: String,
    },
    timeTaken: {
      type: String,
    },
    ansSelected: {
      type: Array,
    },
    majors: {
      type: Array,
    },
    subjects: {
      type: String,
    },
    countriesTraveled: [
      {
        type: String,
      },
    ],
    parentsIncome: {
      type: String,
      enum: ['true', 'false', null],
      default: null,
    },
    qualified: {
      type: Boolean,
    },
    status: {
      type: String,
      enum: [
        'New',
        'Applied',
        'Sent Whatsapp',
        'Closed',
        'Follow-up',
        'Genuine',
        'No Answer',
        'Not Interested',
        'Call Later',
      ],
      default: 'New',
    },
    stage: {
      type: String,
      enum: ['Prospect', 'Application', 'Admitted', 'Enrolled', 'Graduated'],
      default: 'Prospect',
    },
    isQualified: {
      type: Boolean,
      default: false,
    },
    fullname: {
      type: String,
    },
    role: {
      type: String,
      default: 'student',
    },
  },
  {
    timestamps: true,
  }
);

// add plugin that converts mongoose to json
majorSchema.plugin(toJSON);
majorSchema.plugin(paginate);
majorSchema.plugin(slug);
majorSchema.plugin(populate);

/**
 * @typedef Major
 */
const Major = mongoose.model('Major', majorSchema);

module.exports = Major;
