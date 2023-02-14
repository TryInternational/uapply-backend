const mongoose = require('mongoose');
const { toJSON, paginate, slug, mongooseHistory } = require('./plugins');

const countriesSchema = mongoose.Schema(
  {
    name: {
      type: String,
      trim: true,
    },

    code: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: { createdAt: 'createdDate' },
  }
);

// add plugin that converts mongoose to json
countriesSchema.plugin(toJSON);
countriesSchema.plugin(paginate);
countriesSchema.plugin(slug);
countriesSchema.plugin(mongooseHistory);

/**
 * @typedef Booking
 */
const Countries = mongoose.model('Countries', countriesSchema);

module.exports = Countries;
