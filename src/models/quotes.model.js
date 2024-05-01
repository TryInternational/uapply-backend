const mongoose = require('mongoose');
const { toJSON, paginate } = require('./plugins');

const quotesSchema = mongoose.Schema(
  {
    text: String,
    visibility: Boolean,
  },
  {
    timestamps: true,
  }
);

// add plugin that converts mongoose to json
quotesSchema.plugin(toJSON);
quotesSchema.plugin(paginate);

/**
 * @typedef Role
 */
const Role = mongoose.model('Quotes', quotesSchema);

module.exports = Role;
