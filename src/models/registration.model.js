const mongoose = require('mongoose');
const validator = require('validator');
const { toJSON, paginate } = require('./plugins');

const registrationSchema = mongoose.Schema({
  event: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Event',
    required: true
  },
  user: {
    fullName: {
      type: String,
      required: true,
      trim: true
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      validate: {
        validator: function(value) {
          return validator.isEmail(value);
        },
        message: 'Invalid email format'
      }
    },
    phone: {
      type: String,
      required: true,
      validate: {
        validator: function(value) {
          return /^[+]?[0-9]{8,15}$/.test(value);
        },
        message: 'Phone number must be 8-15 digits and may include a + prefix'
      }
    },
    nationality: {
      type: String,
      required: true
    }
  },
  englishLevel: {
    type: String,
    enum: ['beginner', 'elementary', 'intermediate', 'upper-intermediate', 'advanced'],
    required: true
  },
  previousIELTS: {
    type: String,
    enum: ['yes', 'no'],
    required: true
  },
  previousScore: {
    type: String,
    validate: {
      validator: function(v) {
        return this.previousIELTS === 'no' || (v && v.length > 0);
      },
      message: 'Previous score is required when previousIELTS is yes'
    }
  },
  specialRequests: {
    type: String,
    maxlength: [500, 'Special requests cannot exceed 500 characters']
  },
  status: {
    type: String,
    enum: ['confirmed', 'pending', 'cancelled', 'attended', 'no-show'],
    default: 'confirmed'
  },
  registrationDate: {
    type: Date,
    default: Date.now
  },
  confirmationCode: {
    type: String,
    unique: true
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'paid', 'refunded', 'free'],
    default: 'free'
  },
  paymentDetails: {
    amount: Number,
    currency: String,
    transactionId: String,
    paymentMethod: String
  },
  utmData: {
    source: String,
    medium: String,
    campaign: String,
    term: String,
    content: String
  }
}, {
  timestamps: true
});

// Add plugins
registrationSchema.plugin(toJSON);
registrationSchema.plugin(paginate);

// Indexes for performance
registrationSchema.index({ event: 1 });
registrationSchema.index({ 'user.email': 1 });
registrationSchema.index({ status: 1 });
registrationSchema.index({ confirmationCode: 1 });

// Pre-save middleware to generate confirmation code
registrationSchema.pre('save', function(next) {
  if (!this.confirmationCode) {
    this.confirmationCode = 'REG-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9).toUpperCase();
  }
  next();
});

/**
 * Check if user is already registered for an event
 * @param {ObjectId} eventId - The event ID
 * @param {string} email - The user's email
 * @returns {Promise<boolean>}
 */
registrationSchema.statics.isUserRegistered = async function (eventId, email) {
  const registration = await this.findOne({ 
    event: eventId, 
    'user.email': email,
    status: { $ne: 'cancelled' }
  });
  return !!registration;
};

/**
 * @typedef Registration
 */
const Registration = mongoose.model('Registration', registrationSchema);

module.exports = Registration;
