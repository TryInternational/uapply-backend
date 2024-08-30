const mongoose = require('mongoose');
const { toJSON, paginate } = require('./plugins');

const ambassadorsSchema = mongoose.Schema(
  {
    tag: {
      type: Object,
    },
    name: {
      type: String,
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
ambassadorsSchema.plugin(toJSON);
ambassadorsSchema.plugin(paginate);

/**
 * Check if password matches the user's password
 * @returns {Promise<boolean>}
 */

/**
 * @typedef Ambassadors
 */
const Ambassadors = mongoose.model('Ambassadors', ambassadorsSchema);

module.exports = Ambassadors;
