const mongoose = require('mongoose');
const { toJSON, paginate } = require('./plugins');

const exibitionStudentSchema = mongoose.Schema(
  {
    phoneNumber: {
      type: String,
    },

    status: {
      type: String,
      enum: ['Sent', 'not sent', 'not valid'],
      default: 'not sent',
    },
  },
  {
    timestamps: true,
  }
);

// add plugin that converts mongoose to json
exibitionStudentSchema.plugin(toJSON);
exibitionStudentSchema.plugin(paginate);

/**
 * Check if password matches the user's password
 * @returns {Promise<boolean>}
 */

/**
 * @typedef exibitionStudent
 */
const ExibitionStudent = mongoose.model('ExibitionStudent', exibitionStudentSchema);

module.exports = ExibitionStudent;
