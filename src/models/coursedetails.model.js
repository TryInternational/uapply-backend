const mongoose = require('mongoose');
const { toJSON, paginate, slug } = require('./plugins');

const coursedetailsSchema = mongoose.Schema(
  {
    courseRefId: {
      type: String,

      trim: true,
    },
    provider: {
      type: String,
    },
    name: {
      type: String,
      trim: true,
    },
    slug: { type: String, slug: 'name' },
    courseLevel: {
      type: String,
      trim: true,
    },

    subjects: {
      type: Array,
      trim: true,
    },
    courseDurationTypes: {
      type: Array,
      trim: true,
    },
    courseSummary: {
      type: String,
      trim: true,
    },
    locations: {
      type: Array,
    },
    approxAnnualFee: {
      type: Number,
    },

    eligibilityCriteria: {
      type: String,
    },

    programOutlineSummary: {
      type: String,
    },
    deliveryLanguage: {
      type: String,
    },

    courseIntakes: {
      type: Array,
    },
    englishTests: {
      type: Array,
    },
    placementAvailable: {
      type: Boolean,
    },
    scholarshipAvailable: {
      type: Boolean,
    },
    degreeAwarded: {
      type: String,
    },
    careerProspectus: {
      type: String,
    },
    minimumAgeForEligibility: {
      type: String,
    },
    institution: {
      type: Object,
    },
    campusList: {
      type: Array,
    },
  },
  {
    timestamps: { createdAt: 'createdDate' },
  }
);

// add plugin that converts mongoose to json
coursedetailsSchema.plugin(toJSON);
coursedetailsSchema.plugin(paginate);
coursedetailsSchema.plugin(slug);

const CourseDetails = mongoose.model('CourseDetails', coursedetailsSchema);

module.exports = CourseDetails;
