const mongoose = require('mongoose');
const validator = require('validator');
const bcrypt = require('bcryptjs');
const { toJSON, paginate } = require('./plugins');

const eventUserSchema = mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    validate: {
      validator: function(value) {
        return validator.isEmail(value);
      },
      message: 'Invalid email format'
    }
  },
  password: {
    type: String,
    required: true,
    minlength: [6, 'Password must be at least 6 characters long'],
    private: true // used by the toJSON plugin
  },
  role: {
    type: String,
    enum: ['admin', 'staff', 'instructor'],
    default: 'staff'
  },
  permissions: [{
    type: String,
    enum: ['create_events', 'edit_events', 'delete_events', 'view_registrations', 'manage_users']
  }],
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Add plugins
eventUserSchema.plugin(toJSON);
eventUserSchema.plugin(paginate);

// Indexes
eventUserSchema.index({ email: 1 });
eventUserSchema.index({ role: 1 });
eventUserSchema.index({ isActive: 1 });

/**
 * Check if email is taken
 * @param {string} email - The user's email
 * @param {ObjectId} [excludeUserId] - The id of the user to be excluded
 * @returns {Promise<boolean>}
 */
eventUserSchema.statics.isEmailTaken = async function (email, excludeUserId) {
  const user = await this.findOne({ email, _id: { $ne: excludeUserId } });
  return !!user;
};

/**
 * Check if password matches the user's password
 * @param {string} password
 * @returns {Promise<boolean>}
 */
eventUserSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

/**
 * Check if user has specific permission
 * @param {string} permission
 * @returns {boolean}
 */
eventUserSchema.methods.hasPermission = function (permission) {
  return this.permissions.includes(permission) || this.role === 'admin';
};

// Hash password before saving
eventUserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

/**
 * @typedef EventUser
 */
const EventUser = mongoose.model('EventUser', eventUserSchema);

module.exports = EventUser;
