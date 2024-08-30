const mongoose = require('mongoose');
const validator = require('validator');
const bcrypt = require('bcryptjs');
const { toJSON, paginate } = require('./plugins');

const Prefrences = mongoose.Schema({
  studyDestinations: {
    type: String,
  },
  courseDuration: {
    type: Number,
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

const EmergencyContact = mongoose.Schema({
  firstName: {
    type: String,
  },
  lastName: {
    type: String,
  },
  relation: {
    type: String,
  },
  email: {
    type: String,
  },
  emergencyContactNo: {
    type: String,
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
    assignedTo: [
      {
        user: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', autopopulate: true },
        role: { type: String, required: true },
      },
    ],

    middleName: {
      type: String,
      trim: true,
    },
    backlogs: { type: Boolean },
    educationGaps: { type: Boolean },
    ieltsScore: {
      type: String,
      trim: true,
    },
    ieltsTaken: {
      type: String,
      enum: ['Yes', 'No', 'Waiting for results'],
    },
    gender: {
      type: String,
      enum: ['Male', 'Female', 'Others'],
    },
    stage: {
      type: String,
      enum: ['NotApplied', 'Applied', 'Lost', 'Enrolled'],
      default: 'NotApplied',
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
    lostReason: {
      type: String,
      trim: true,
    },
    lost: {
      type: Boolean,
    },
    ambassadorName: {
      type: String,
    },
    ambassador: {
      type: [{ type: mongoose.SchemaTypes.ObjectId, ref: ' Ambassadors' }],
    },
    importantComment: {
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
    refrenceNo: {
      type: String,
      required: true,
    },
    source: {
      type: String,
      enum: ['ulearn', 'uapply'],
      default: 'uapply',
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
    dob: {
      type: Date,
    },
    isClosed: {
      type: Boolean,
      default: false,
    },
    shortlistedCourses: {
      type: [{ type: mongoose.SchemaTypes.ObjectId, ref: 'Courses' }],
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
      type: [String],
      enum: ['Missing documents', 'Missing ielts'],
    },
    emergencyContact: {
      type: [EmergencyContact],
    },
    sourceOfFund: {
      type: String,
      enum: ['Other', 'Govt Sponsor', 'Help From Family', 'Personal Savings', 'Private Bank Loan', 'Require Scholarship'],
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
    onHold: {
      type: Boolean,
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

studentsSchema.statics.isEmailTaken = async function (email, excludeUserId) {
  const user = await this.findOne({ email, _id: { $ne: excludeUserId } });
  return !!user;
};

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
