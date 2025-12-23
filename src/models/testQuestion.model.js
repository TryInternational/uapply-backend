const mongoose = require('mongoose');
const { toJSON, paginate } = require('./plugins');

const optionSchema = mongoose.Schema(
  {
    text: {
      type: String,
      required: true,
    },
    answer: {
      type: Boolean,
      required: true,
      default: false,
    },
    key: {
      type: Number,
      required: true,
    },
  },
  { _id: false } // Prevents automatic _id creation for subdocuments
);

const testQuestionSchema = mongoose.Schema(
  {
    question: {
      type: String,
      required: true,
    },
    options: {
      type: [optionSchema],
      required: true,
      validate: {
        validator(v) {
          return v.length === 4; // Ensure exactly 4 options
        },
        message: (props) => `Question must have exactly 4 options, got ${props.value.length}`,
      },
    },
    testType: {
      type: String,
      enum: ['English', 'MathEnglish', 'MathArabic'],
      required: true,
    },
    section: {
      type: String,
      enum: ['Grammar', 'Vocabulary', 'Comprehension', 'Mathematics'],
      required: true,
    },
    paragraphContent: {
      type: String,
    },
    language: {
      type: String,
      enum: ['English', 'Arabic'],
      default: 'English',
    },
    createdDate: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Add plugins
testQuestionSchema.plugin(toJSON);
testQuestionSchema.plugin(paginate);

/**
 * @typedef TestQuestion
 */
const TestQuestion = mongoose.model('TestQuestion', testQuestionSchema);

module.exports = TestQuestion;
