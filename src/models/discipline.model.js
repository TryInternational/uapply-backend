const mongoose = require('mongoose');
const { toJSON, paginate } = require('./plugins');

const disciplineSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    value: {
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
disciplineSchema.plugin(toJSON);
disciplineSchema.plugin(paginate);

/**
 * @typedef Discipline
 */
const Discipline = mongoose.model('Discipline', disciplineSchema);

module.exports = Discipline;
