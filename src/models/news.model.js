const mongoose = require('mongoose');
const { toJSON, paginate } = require('./plugins');

const NewsSchema = mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    thumbnail: {
      type: String,
      required: true,
    },
    subtitle: {
      type: String,
    },
    body: {
      type: String,
      required: true,
    },
    createdAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
  }
);

// add plugin that converts mongoose to json
NewsSchema.plugin(toJSON);
NewsSchema.plugin(paginate);

/**
 * @typedef News
 */
const News = mongoose.model('News', NewsSchema);

module.exports = News;
