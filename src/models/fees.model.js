const mongoose = require('mongoose');
const { toJSON, paginate } = require('./plugins');

const feesSchema = mongoose.Schema(
  {
    tag: {
      type: Object,
    },
    feeType: {
      type: String,
      enum: ['ielts-booking', 'office-fees', 'student-visa'],
    },
    createdDate: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// add plugin that converts mongoose to json
feesSchema.plugin(toJSON);
feesSchema.plugin(paginate);

/**
 * Check if password matches the user's password
 * @returns {Promise<boolean>}
 */

/**
 * @typedef fees
 */
const Fees = mongoose.model('Fees', feesSchema);

module.exports = Fees;
