const mongoose = require('mongoose');
const { toJSON, paginate, slug, mongooseHistory } = require('./plugins');

const coursesSchema = mongoose.Schema(
  {
    courseRefId: {
      type: String,

      trim: true,
    },
    courseId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Coupon',
    },
    name: {
      type: String,
      trim: true,
    },
    slug: { type: String, slug: 'name' },
    institution: {
      type: String,
      trim: true,
    },

    intakeMonths: {
      type: Array,
      trim: true,
    },
    courseDurationTypes: {
      type: Array,
      trim: true,
    },
    courseLevel: {
      type: String,
      trim: true,
    },
    locations: {
      type: Array,
    },
    approxAnnualFee: {
      type: Number,
    },
    currency: {
      type: String,
    },
    institutionSlug: {
      type: String,
    },
    subjects: {
      type: Array,
    },
    placementAvailable: {
      type: Boolean,
    },
    attendanceTypes: {
      type: Array,
    },
    courseDurationValues: {
      type: Array,
    },
  },
  {
    timestamps: { createdAt: 'createdDate' },
  }
);

// add plugin that converts mongoose to json
coursesSchema.plugin(toJSON);
coursesSchema.plugin(paginate);
coursesSchema.plugin(slug);
coursesSchema.plugin(mongooseHistory);

/**
 * @typedef Booking
 */
const Courses = mongoose.model('Courses', coursesSchema);

module.exports = Courses;
