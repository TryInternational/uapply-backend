const mongoose = require('mongoose');
const { toJSON, paginate } = require('./plugins');

const educationSchema = mongoose.Schema(
  {
    country: {
      type: String,
      required: true,
    },
    studentId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Students',
    },
    qualification: {
      type: String,
      enum: ['Diploma', 'Doctoral', 'Higher secondary', 'PG Diploma', 'Postgraduate', 'Undergraduate', 'Other'],
      required: true,
    },
    discipline: {
      type: String,
      required: true,
    },
    institution: {
      type: String,
      required: true,
    },
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
      required: true,
    },
    gradingSystem: {
      type: String,
      enum: ['Percentage', 'GPA', 'CGPA'],
      default: 'Percentage',
      required: true,
    },
    score: {
      type: String,
      required: true,
    },
    document: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

// add plugin that converts mongoose to json
educationSchema.plugin(toJSON);
educationSchema.plugin(paginate);

/**
 * Check if password matches the user's password
 * @param {string} password
 * @returns {Promise<boolean>}
 */

/**
 * @typedef Education
 */
const Education = mongoose.model('Education', educationSchema);

module.exports = Education;
