const mongoose = require('mongoose');
const { toJSON, paginate } = require('./plugins');

const schoolSchema = mongoose.Schema(
  {
    english_name: {
      type: String,
      required: true,
      trim: true,
    },
    countryName: {
      type: String,
      required: true,
      trim: true,
    },
  },

  {
    timestamps: true,
  }
);

schoolSchema.plugin(toJSON);
schoolSchema.plugin(paginate);

const School = mongoose.model('School', schoolSchema);

module.exports = School;
