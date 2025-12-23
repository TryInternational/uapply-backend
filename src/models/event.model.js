const mongoose = require('mongoose');
const { toJSON, paginate } = require('./plugins');

const eventSchema = mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  type: {
    type: String,
    enum: ['IELTS', 'CONSULTATION', 'WORKSHOP', 'SEMINAR'],
    default: 'IELTS',
    required: true
  },
  date: {
    type: Date,
    required: true,
    validate: {
      validator: function(value) {
        return value > new Date();
      },
      message: 'Event date must be in the future'
    }
  },
  startTime: {
    type: String,
    required: true,
    validate: {
      validator: function(value) {
        return /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(value);
      },
      message: 'Start time must be in HH:MM format'
    }
  },
  endTime: {
    type: String,
    required: true,
    validate: {
      validator: function(value) {
        return /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(value);
      },
      message: 'End time must be in HH:MM format'
    }
  },
  location: {
    type: String,
    required: true
  },
  totalSeats: {
    type: Number,
    required: true,
    min: [1, 'Total seats must be at least 1']
  },
  availableSeats: {
    type: Number,
    required: true,
    min: [0, 'Available seats cannot be negative'],
    validate: {
      validator: function(value) {
        return value <= this.totalSeats;
      },
      message: 'Available seats cannot exceed total seats'
    }
  },
  price: {
    type: Number,
    default: 0,
    min: [0, 'Price cannot be negative']
  },
  currency: {
    type: String,
    default: 'KWD',
    enum: ['KWD', 'USD', 'EUR']
  },
  status: {
    type: String,
    enum: ['active', 'cancelled', 'completed', 'draft'],
    default: 'active'
  },
  instructor: {
    name: String,
    email: String,
    phone: String
  },
  requirements: [String],
  tags: [String],
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

// Add plugins
eventSchema.plugin(toJSON);
eventSchema.plugin(paginate);

// Indexes for performance
eventSchema.index({ date: 1, type: 1 });
eventSchema.index({ status: 1 });
eventSchema.index({ createdBy: 1 });

// Virtual for registration count
eventSchema.virtual('registrationCount').get(function() {
  return this.totalSeats - this.availableSeats;
});

// Ensure virtual fields are serialized
eventSchema.set('toJSON', { virtuals: true });

/**
 * @typedef Event
 */
const Event = mongoose.model('Event', eventSchema);

module.exports = Event;
