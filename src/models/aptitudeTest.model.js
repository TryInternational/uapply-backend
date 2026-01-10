const mongoose = require('mongoose');
const { toJSON, paginate } = require('./plugins');

const aptitudeTestSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    number: {
      type: String,
      required: true,
      trim: true,
    },
    dob: {
      type: Date,
      required: true,
    },
    score: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },
    testType: {
      type: String,
      required: true,
    },
    language: {
      type: String,
      required: true,
    },
    destination: {
      type: String,
      required: true,
    },
    degree: {
      type: String,
      required: true,
    },
    nationality: {
      type: Object,
      required: true,
    },
    timeTaken: {
      type: Number, // in minutes
      required: true,
      min: 0,
    },
    status: {
      type: String,
      enum: ['New', 'Sent Whatsapp'],
      default: 'New',
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Add plugins
aptitudeTestSchema.plugin(toJSON);
aptitudeTestSchema.plugin(paginate);

const AptitudeTest = mongoose.model('AptitudeTest', aptitudeTestSchema);

module.exports = AptitudeTest;
