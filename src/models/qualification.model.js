const mongoose = require('mongoose');
const { toJSON, paginate } = require('./plugins');

const qualificationSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

// add plugin that converts mongoose to json
qualificationSchema.plugin(toJSON);
qualificationSchema.plugin(paginate);

/**
 * @typedef Role
 */
const Role = mongoose.model('Qualification', qualificationSchema);

module.exports = Role;
