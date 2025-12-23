const mongoose = require('mongoose');
const validator = require('validator');
const { toJSON, paginate } = require('./plugins');

const ieltsRegistrationSchema = mongoose.Schema(
  {
    // Basic Information
    name: {
      type: String,
      required: true,
      trim: true,
    },
    age: {
      type: String,
      required: true,
    },
    phoneNumber: {
      type: String,
      required: true,
      validate: {
        validator: function (value) {
          return /^[+]?[0-9]{8,15}$/.test(value);
        },
        message: 'Phone number must be 8-15 digits and may include a + prefix',
      },
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      validate: {
        validator: function (value) {
          return validator.isEmail(value);
        },
        message: 'Invalid email format',
      },
    },
    nationality: {
      type: String,
      required: true,
    },

    // Study Preferences
    studyDestination: {
      type: String,
      required: true,
      enum: ['uk', 'other'], // UK or Other Country
    },

    // IELTS Experience
    previousIELTS: {
      type: String,
      required: true,
      enum: ['yes', 'no'], // Yes or No
    },

    // English Level Assessment
    englishLevel: {
      type: String,
      required: true,
      enum: ['weak', 'average', 'excellent'], // Weak, Average, Excellent
    },

    // Academic Information
    fieldOfStudy: {
      type: String,
      required: true,
    },

    // Registration Time (for calendar bookings)
    registrationTime: {
      type: String,
      required: false,
    },

    // Additional guests (optional)
    guests: [
      {
        name: String,
        email: String,
        phone: String,
      },
    ],

    // Registration metadata
    registrationDate: {
      type: Date,
      default: Date.now,
    },
    confirmationCode: {
      type: String,
      unique: true,
    },
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'cancelled'],
      default: 'confirmed',
    },

    // Google Sheets sync status
    syncedToSheets: {
      type: Boolean,
      default: false,
    },
    sheetsSyncDate: {
      type: Date,
    },
    sheetsSyncError: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

// Add plugins
ieltsRegistrationSchema.plugin(toJSON);
ieltsRegistrationSchema.plugin(paginate);

// Indexes for performance
ieltsRegistrationSchema.index({ email: 1 });
ieltsRegistrationSchema.index({ confirmationCode: 1 });
ieltsRegistrationSchema.index({ registrationDate: -1 });

// Pre-save middleware to generate confirmation code
ieltsRegistrationSchema.pre('save', function (next) {
  if (!this.confirmationCode) {
    this.confirmationCode = 'IELTS-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9).toUpperCase();
  }
  next();
});

/**
 * Check if email is already registered
 * @param {string} email - The user's email
 * @returns {Promise<boolean>}
 */
ieltsRegistrationSchema.statics.isEmailRegistered = async function (email) {
  const registration = await this.findOne({
    email: email.toLowerCase(),
    status: { $ne: 'cancelled' },
  });
  return !!registration;
};

/**
 * @typedef IeltsRegistration
 */
const IeltsRegistration = mongoose.model('IeltsRegistration', ieltsRegistrationSchema);

module.exports = IeltsRegistration;
