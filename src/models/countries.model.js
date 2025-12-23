const mongoose = require('mongoose');
const { toJSON, paginate, slug, trackable } = require('./plugins');

const countriesSchema = mongoose.Schema(
  {
    english_name: {
      type: String,
      trim: true,
    },

    arabic_name: {
      type: String,
      trim: true,
    },

    alpha2_code: {
      type: String,
      trim: true,
    },
    alpha3_code: {
      type: String,
      trim: true,
    },

    phone_code: {
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
countriesSchema.plugin(trackable);

/**
 * @typedef Booking
 */
const Countries = mongoose.model('Countries', countriesSchema);

module.exports = Countries;
