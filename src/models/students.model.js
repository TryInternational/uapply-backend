const mongoose = require('mongoose');
const validator = require('validator');
const bcrypt = require('bcryptjs');
const { toJSON, paginate } = require('./plugins');

const Prefrences = mongoose.Schema({
  studyDestinations: {
    type: String,
  },
  courseLevel: {
    type: String,
  },
  courseSubjectIds: {
    type: Array,
  },
  intakeYear: {
    type: String,
  },
  intakeMonth: {
    type: String,
  },
  budget: {
    type: String,
  },
  budgetRange: {
    type: String,
  },
  currency: {
    type: String,
  },
  fundingSource: { type: String },
  sponserName: {
    type: String,
  },
  otherDetail: {
    type: String,
  },
  needScholarship: {
    type: Boolean,
    default: false,
  },
  needPlacement: {
    type: Boolean,
    default: false,
  },
});

const studentsSchema = mongoose.Schema(
  {
    firstName: {
      type: String,
      required: true,
      trim: true,
    },
    lastName: {
      type: String,
      required: true,
      trim: true,
    },
    gender: {
      type: String,
      enum: ['Male', 'Female', 'Others', 'Not Willing To Disclose'],
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
    motherTongue: {
      type: String,
    },
    cgpa: {
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
    preference: Prefrences,
    qualified: {
      type: Boolean,
      required: true,
      default: false,
    },
    // profilePhotoUrl: {
    //   type: String,
    //   required: true,
    // },
    isClosed: {
      type: Boolean,
      default: false,
    },
    shortlistedCourses: {
      type: Array,
    },
    passportStatus: {
      type: String,
    },
    visaRejected: {
      type: Boolean,
      default: false,
    },
    passportNo: {
      type: String,
    },
    selectedUniversity: {
      type: Array,
    },
    status: {
      type: String,
      enum: ['New', 'Sent Whatsapp', 'Applied', 'Closed', 'Lost', 'Not Responding', 'Interested'],
      default: 'New',
    },
    emergencyContact: {
      type: Array,
    },
    // destination: {
    //   type: Object,
    // },
    // degree: {
    //   type: Object,
    // },
    // subjects: {
    //   type: String,
    // },
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
studentsSchema.plugin(toJSON);
studentsSchema.plugin(paginate);

// /**
//  * Check if email is taken
//  * @param {string} email - The user's email
//  * @param {ObjectId} [excludeStudentId] - The id of the user to be excluded
//  * @returns {Promise<boolean>}
//  */
// studentsSchema.statics.isEmailTaken = async function (email, excludeStudentId) {
//   const student = await this.findOne({ email, _id: { $ne: excludeStudentId } });
//   return !!student;
// };

/**
 * Check if password matches the user's password
 * @param {string} password
 * @returns {Promise<boolean>}
 */
studentsSchema.methods.isPasswordMatch = async function (password) {
  const student = this;
  return bcrypt.compare(password, student.password);
};

studentsSchema.pre('save', async function (next) {
  const student = this;
  if (student.isModified('password')) {
    student.password = await bcrypt.hash(student.password, 8);
  }
  next();
});

/**
 * @typedef Students
 */
const Students = mongoose.model('Students', studentsSchema);

module.exports = Students;
