const mongoose = require('mongoose');
const { toJSON, paginate, slug, mongooseHistory } = require('./plugins');

const courseLevelSchema = mongoose.Schema(
  {
    en_name: {
      type: String,
      trim: true,
    },
    ar_name: {
      type: String,
      trim: true,
    },
    slug: { type: String, slug: 'en_name' },
  },
  {
    timestamps: { createdAt: 'createdDate' },
  }
);

// add plugin that converts mongoose to json
courseLevelSchema.plugin(toJSON);
courseLevelSchema.plugin(paginate);
courseLevelSchema.plugin(slug);
courseLevelSchema.plugin(mongooseHistory);

/**
 * @typedef CourseLevels
 */
const CourseLevels = mongoose.model('CourseLevels', courseLevelSchema);

module.exports = CourseLevels;
