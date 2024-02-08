const mongoose = require('mongoose');
const { toJSON, paginate } = require('./plugins');

const feesSchema = mongoose.Schema(
  {
    description: {
      type: String,
    },
    amount: {
      type: Number,
    },
    salesPerson: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Users',
    },
    type: {
      type: Array,
    },
    createdMonth: {
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
