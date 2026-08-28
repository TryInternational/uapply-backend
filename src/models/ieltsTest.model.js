// models/ieltsTest.model.js
const mongoose = require('mongoose');
const { toJSON } = require('./plugins');

const ieltsTestSchema = new mongoose.Schema(
  {
    // User Information
    studentId: {
      // optional link to the UlearnStudent who took this attempt (additive:
      // anonymous submissions leave it null). Indexed for history/progress.
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'UlearnStudent',
      default: null,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      required: false,
    },
    dob: {
      type: Date,
    },
    nationality: {
      type: String,
      trim: true,
    },

    // Attempt Tracking
    attemptNumber: {
      type: Number,
      min: 1,
      max: 5,
      required: true,
      default: 1,
    },
    attemptsUsed: {
      type: Number,
      min: 0,
      max: 5,
      default: 0,
    },
    attemptsLeft: {
      type: Number,
      min: 0,
      max: 5,
      default: 5,
    },
    lastAttemptDate: {
      type: Date,
    },
    isFirstAttempt: {
      type: Boolean,
      default: true,
    },
    isLastAttempt: {
      type: Boolean,
      default: false,
    },

    // Test Results
    scores: {
      overall: {
        bandScore: {
          type: Number,
          min: 0,
          max: 9,
        },
        level: {
          type: String,
          enum: ['Expert User', 'Very Good User', 'Good User', 'Competent User', 'Modest User', 'Limited User'],
        },
      },
      reading: {
        bandScore: {
          type: Number,
          min: 0,
          max: 9,
        },
        correct: Number,
        incorrect: Number,
        skipped: Number,
        total: Number,
        percentage: Number,
      },
      writing: {
        bandScore: {
          type: Number,
          min: 0,
          max: 9,
        },
        task1: {
          bandScore: Number,
          wordCount: Number,
          feedback: String,
        },
        task2: {
          bandScore: Number,
          wordCount: Number,
          feedback: String,
        },
      },
      listening: {
        bandScore: {
          type: Number,
          min: 0,
          max: 9,
        },
        correct: Number,
        incorrect: Number,
        skipped: Number,
        total: Number,
        percentage: Number,
      },
    },

    // Test Details
    testType: {
      type: String,
      enum: ['Academic', 'General Training'],
      default: 'Academic',
    },
    testVersion: {
      type: String,
    },

    // Test Duration
    timeTaken: {
      total: Number,
      formatted: String,
      sections: {
        reading: String,
        writing: String,
        listening: String,
      },
    },

    // User Answers
    answers: {
      reading: {
        type: Map,
        of: mongoose.Schema.Types.Mixed,
      },
      writing: {
        task1: String,
        task2: String,
      },
      listening: {
        type: Map,
        of: String,
      },
    },

    // Section Times
    sectionTimes: {
      reading: {
        start: Date,
        end: Date,
      },
      writing: {
        start: Date,
        end: Date,
      },
      listening: {
        start: Date,
        end: Date,
      },
    },

    // Test Metadata
    startTime: {
      type: Date,
      default: Date.now,
    },
    endTime: {
      type: Date,
    },
    completedAt: {
      type: Date,
    },

    // Status
    status: {
      type: String,
      enum: ['New', 'Sent Whatsapp', 'Contacted', 'Qualified', 'Not Qualified'],
      default: 'New',
    },
    testStatus: {
      type: String,
      enum: ['Completed', 'Max Attempts Reached', 'In Progress'],
      default: 'Completed',
    },

    // Additional Info
    destination: {
      type: String,
      trim: true,
    },
    studyLevel: {
      type: String,
      trim: true,
    },
    targetScore: {
      type: Number,
      min: 0,
      max: 9,
    },

    // Score Analysis
    analysis: {
      strengths: [String],
      weaknesses: [String],
      recommendations: [String],
      estimatedPreparationTime: String,
    },

    // Question Details
    questionDetails: {
      reading: [
        {
          questionId: String,
          userAnswer: mongoose.Schema.Types.Mixed,
          correctAnswer: mongoose.Schema.Types.Mixed,
          isCorrect: Boolean,
          questionType: String,
          topic: String,
          difficulty: String,
        },
      ],
      listening: [
        {
          questionId: String,
          userAnswer: String,
          correctAnswer: String,
          isCorrect: Boolean,
          questionType: String,
          audioSection: String,
          difficulty: String,
        },
      ],
    },

    // WhatsApp notification status
    whatsappStatus: {
      type: String,
      enum: ['Not Sent', 'Sent', 'Failed'],
      default: 'Not Sent',
    },
    whatsappSentAt: {
      type: Date,
    },

    // Cooldown period
    cooldownUntil: {
      type: Date,
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

// Static method to check if user can take another test
ieltsTestSchema.statics.canUserTakeTest = async function (phone) {
  try {
    if (!phone || typeof phone !== 'string') {
      return {
        canTakeTest: false,
        reason: 'INVALID_PHONE',
        attemptsUsed: 0,
        attemptsLeft: 0,
        message: 'Invalid phone number provided.',
      };
    }

    const cleanedPhone = phone.replace(/[+\s]/g, '');
    const userTests = await this.find({
      phone: cleanedPhone,
      status: { $in: ['Completed', 'Max Attempts Reached'] },
    }).sort({ createdAt: -1 });

    const totalAttempts = userTests.length;

    if (totalAttempts >= 5) {
      const lastTest = userTests[0];
      if (lastTest && lastTest.createdAt) {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        if (lastTest.createdAt > thirtyDaysAgo) {
          return {
            canTakeTest: false,
            reason: 'MAX_ATTEMPTS_REACHED',
            attemptsUsed: totalAttempts,
            attemptsLeft: 0,
            cooldownUntil: new Date(lastTest.createdAt.getTime() + 30 * 24 * 60 * 60 * 1000),
            message: 'You have reached the maximum of 5 test attempts. Please try again after 30 days.',
          };
        }
      }
      return {
        canTakeTest: true,
        reason: 'COOLDOWN_PASSED',
        attemptsUsed: 5,
        attemptsLeft: 0,
        message: 'Previous cooldown period has passed. You can take the test again.',
      };
    }

    return {
      canTakeTest: true,
      reason: 'ATTEMPTS_AVAILABLE',
      attemptsUsed: totalAttempts,
      attemptsLeft: 5 - totalAttempts,
      message: `You have ${5 - totalAttempts} attempt(s) left.`,
    };
  } catch (error) {
    console.error('Error in canUserTakeTest:', error);
    return {
      canTakeTest: true,
      reason: 'ERROR',
      attemptsUsed: 0,
      attemptsLeft: 5,
      message: 'Unable to check eligibility. Please try again.',
    };
  }
};

// Static method to get user's test history
ieltsTestSchema.statics.getUserTestHistory = async function (phone) {
  try {
    const cleanedPhone = phone.replace(/[+\s]/g, '');
    return await this.find({ phone: cleanedPhone })
      .sort({ createdAt: -1 })
      .select('attemptNumber scores.overall.bandScore scores.overall.level status createdAt timeTaken.formatted');
  } catch (error) {
    console.error('Error in getUserTestHistory:', error);
    return [];
  }
};

// Method to calculate next attempt number
ieltsTestSchema.statics.getNextAttemptNumber = async function (phone) {
  try {
    const cleanedPhone = phone.replace(/[+\s]/g, '');
    const lastTest = await this.findOne({ phone: cleanedPhone }).sort({ attemptNumber: -1 }).select('attemptNumber');
    return lastTest ? lastTest.attemptNumber + 1 : 1;
  } catch (error) {
    console.error('Error in getNextAttemptNumber:', error);
    return 1;
  }
};

// Pre-save middleware
ieltsTestSchema.pre('save', async function (next) {
  try {
    if (this.isNew) {
      const cleanedPhone = this.phone ? this.phone.replace(/[+\s]/g, '') : '';
      this.phone = cleanedPhone;

      const previousTests = await this.constructor.find({ phone: cleanedPhone });
      const completedTests = previousTests.filter((test) => test.testStatus === 'Completed');

      this.attemptNumber = completedTests.length + 1;
      this.attemptsUsed = completedTests.length;
      this.attemptsLeft = Math.max(0, 5 - completedTests.length);
      this.isFirstAttempt = completedTests.length === 0;
      this.isLastAttempt = completedTests.length === 4;

      if (completedTests.length >= 5) {
        this.testStatus = 'Max Attempts Reached';
        const error = new Error('Maximum test attempts (5) reached');
        error.name = 'MaxAttemptsError';
        return next(error);
      }
    }

    if (this.isModified('testStatus') && this.testStatus === 'Completed') {
      this.lastAttemptDate = new Date();
      this.attemptsUsed = (this.attemptsUsed || 0) + 1;
      this.attemptsLeft = Math.max(0, 5 - this.attemptsUsed);

      if (this.attemptsUsed >= 5) {
        this.testStatus = 'Max Attempts Reached';
        this.cooldownUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      }
    }

    next();
  } catch (error) {
    console.error('Error in pre-save middleware:', error);
    next(error);
  }
});

// Add custom paginate method
ieltsTestSchema.statics.paginate = async function (filter, options) {
  try {
    let sort = '';
    if (options.sortBy) {
      const sortingCriteria = [];
      options.sortBy.split(',').forEach((sortOption) => {
        const [key, order] = sortOption.split(':');
        sortingCriteria.push((order === 'desc' ? '-' : '') + key);
      });
      sort = sortingCriteria.join(' ');
    } else {
      sort = 'createdAt';
    }

    const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 10;
    const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
    const skip = (page - 1) * limit;

    const countPromise = this.countDocuments(filter).exec();
    let docsPromise = this.find(filter).sort(sort).skip(skip).limit(limit);

    if (options.populate) {
      options.populate.split(',').forEach((populateOption) => {
        docsPromise = docsPromise.populate(
          populateOption
            .split('.')
            .reverse()
            .reduce((a, b) => ({ path: b, populate: a }))
        );
      });
    }

    docsPromise = docsPromise.exec();

    return Promise.all([countPromise, docsPromise]).then((values) => {
      const [totalResults, results] = values;
      const totalPages = Math.ceil(totalResults / limit);
      const result = {
        results,
        page,
        limit,
        totalPages,
        totalResults,
      };
      return Promise.resolve(result);
    });
  } catch (error) {
    console.error('Error in paginate method:', error);
    throw error;
  }
};

// Add indexes
ieltsTestSchema.index({ phone: 1, createdAt: -1 });
ieltsTestSchema.index({ status: 1 });
ieltsTestSchema.index({ 'scores.overall.bandScore': -1 });
ieltsTestSchema.index({ completedAt: -1 });
ieltsTestSchema.index({ whatsappStatus: 1 });

// Add plugins
ieltsTestSchema.plugin(toJSON);

const IELTSTest = mongoose.model('IELTSTest', ieltsTestSchema);

module.exports = IELTSTest;
