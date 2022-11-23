const mongoose = require('mongoose');
const { toJSON, paginate, slug } = require('./plugins');

const subjectsSchema = mongoose.Schema(
  {
    name: {
      type: String,
      trim: true,
    },
    slug: { type: String, slug: 'name' },
  },
  {
    timestamps: { createdAt: 'createdDate' },
  }
);

// add plugin that converts mongoose to json
subjectsSchema.plugin(toJSON);
subjectsSchema.plugin(paginate);
subjectsSchema.plugin(slug);

/**
 * @typedef Booking
 */
const Subjects = mongoose.model('Subjects', subjectsSchema);

module.exports = Subjects;
