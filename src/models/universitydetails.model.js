const mongoose = require('mongoose');
const { toJSON, paginate, slug } = require('./plugins');

const universityDetailsSchema = mongoose.Schema(
  {
    name: {
      type: String,
      trim: true,
    },

    logoUrl: {
      type: String,
      trim: true,
    },
    slug: { type: String, slug: 'name' },
    bannerUrl: {
      type: String,
      trim: true,
    },
    overview: {
      type: String,
    },
    ranking: {
      type: Array,
    },
    studentLife: {
      type: String,
    },
    campusLife: {
      type: String,
    },
    alumini: {
      type: String,
    },
    country: {
      type: String,
    },
    facilities: {
      type: Array,
    },
    gallery: {
      type: Array,
    },
    totalStudents: {
      type: String,
    },
    tags: {
      type: Array,
    },
    subjects: {
      type: Object,
    },
  },
  {
    timestamps: { createdAt: 'createdDate' },
  }
);

// add plugin that converts mongoose to json
universityDetailsSchema.plugin(toJSON);
universityDetailsSchema.plugin(paginate);
universityDetailsSchema.plugin(slug);

const UniversityDetails = mongoose.model('UniversityDetails', universityDetailsSchema);

module.exports = UniversityDetails;
