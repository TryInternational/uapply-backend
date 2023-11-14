const mongoose = require('mongoose');
const validator = require('validator');
const bcrypt = require('bcryptjs');
const { toJSON, paginate } = require('./plugins');

const leadsSchema = mongoose.Schema(
  {
    fullname: {
      type: String,
      required: true,
      trim: true,
    },
    residence: {
      type: Object,
      required: true,
      trim: true,
    },
    city: {
      type: String,
      trim: true,
    },
    cgpa: {
      type: String,
      trim: true,
    },
    engLevel: {
      type: String,
      trim: true,
    },
    iltesScore: {
      type: String,
      trim: true,
    },
    phoneNo: {
      type: String,
      required: true,
    },
    applications: {
      type: Array,
      required: true,
    },
    qualified: {
      type: Boolean,
      required: true,
      default: false,
    },
    selectedUniversity: {
      type: Array,
    },
    status: {
      type: String,
      enum: ['New', 'Sent Whatsapp', 'Applied', 'Closed', 'Lost', 'Not Responding', 'Interested'],
      default: 'New',
    },
    sponsored: {
      type: String,
    },
    webUrl: {
      type: String,
    },

    source: {
      type: String,
      enum: ['ulearn', 'uapply'],
      default: 'uapply',
    },
    sponsoredBy: {
      type: String,
    },
    destination: {
      type: Object,
    },
    degree: {
      type: Object,
    },
    subjects: {
      type: String,
    },
    nationality: {
      type: Object,
    },
    parentsIncome: {
      type: String,
    },
    previousSchool: {
      type: String,
    },
    countriesTraveled: {
      type: Array,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      validate(value) {
        if (!validator.isEmail(value)) {
          throw new Error('Invalid email');
        }
      },
    },
    password: {
      type: String,
      trim: true,
      minlength: 8,
      validate(value) {
        if (!value.match(/\d/) || !value.match(/[a-zA-Z]/)) {
          throw new Error('Password must contain at least one letter and one number');
        }
      },
      private: true, // used by the toJSON plugin
    },

    isEmailVerified: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// add plugin that converts mongoose to json
leadsSchema.plugin(toJSON);
leadsSchema.plugin(paginate);

// /**
//  * Check if email is taken
//  * @param {string} email - The user's email
//  * @param {ObjectId} [excludeStudentId] - The id of the user to be excluded
//  * @returns {Promise<boolean>}
//  */
// leadsSchema.statics.isEmailTaken = async function (email, excludeStudentId) {
//   const student = await this.findOne({ email, _id: { $ne: excludeStudentId } });
//   return !!student;
// };

/**
 * Check if password matches the user's password
 * @param {string} password
 * @returns {Promise<boolean>}
 */
leadsSchema.methods.isPasswordMatch = async function (password) {
  const student = this;
  return bcrypt.compare(password, student.password);
};

leadsSchema.pre('save', async function (next) {
  const student = this;
  if (student.isModified('password')) {
    student.password = await bcrypt.hash(student.password, 8);
  }
  next();
});

/**
 * @typedef Leads
 */
const Leads = mongoose.model('Leads', leadsSchema);

module.exports = Leads;
