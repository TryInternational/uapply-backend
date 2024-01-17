const mongoose = require('mongoose');
const { toJSON, paginate } = require('./plugins');

const sponsorStudents = mongoose.Schema(
  {
    phoneNumber: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
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
sponsorStudents.plugin(toJSON);
sponsorStudents.plugin(paginate);

/**
 * @typedef SponsorStudents
 */
const SponsorStudents = mongoose.model('SponsorStudents', sponsorStudents);

module.exports = SponsorStudents;
