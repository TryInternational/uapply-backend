const mongoose = require('mongoose');
const { toJSON, paginate } = require('./plugins');

const WorkExperienceSchema = mongoose.Schema(
  {
    organisationName: {
      type: String,
      required: true,
    },
    studentId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Students',
    },
    currentCompany: {
      type: Boolean,
      default: false,
    },
    designation: {
      type: String,
      required: true,
    },
    joiningDate: {
      type: Date,
      required: true,
    },
    relievingDate: {
      type: Date,
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
WorkExperienceSchema.plugin(toJSON);
WorkExperienceSchema.plugin(paginate);

/**
 * Check if password matches the user's password
 * @param {string} password
 * @returns {Promise<boolean>}
 */

/**
 * @typedef WorkExperience
 */
const WorkExperience = mongoose.model('WorkExperience', WorkExperienceSchema);

module.exports = WorkExperience;
