const mongoose = require('mongoose');
const { toJSON, paginate, slug } = require('./plugins');

const universitiesSchema = mongoose.Schema(
  {
    name: {
      type: String,

      trim: true,
    },

    institutionRefId: {
      type: String,
      trim: true,
    },
    slug: { type: String, slug: 'name' },
    institution: {
      type: String,
      trim: true,
    },

    logoUrl: {
      type: String,
      trim: true,
    },
    country: {
      type: String,
    },
  },
  {
    timestamps: { createdAt: 'createdDate' },
  }
);

// add plugin that converts mongoose to json
universitiesSchema.plugin(toJSON);
universitiesSchema.plugin(paginate);
universitiesSchema.plugin(slug);

/**
 * @typedef Booking
 */
const Universities = mongoose.model('Universities', universitiesSchema);

module.exports = Universities;
