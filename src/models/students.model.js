const mongoose = require('mongoose');
const validator = require('validator');
const bcrypt = require('bcryptjs');
const { toJSON, paginate } = require('./plugins');
const User = require('./user.model');

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
  // Universities / destination countries a student wants to apply to. Captured
  // by the Sub-agent portal's Add Student flow (names). Without these the values
  // were silently dropped by the strict schema.
  universities: {
    type: Array,
  },
  destinations: {
    type: Array,
  },
  intakeYear: {
    type: String,
  },
  intakeMonth: {
    type: String,
  },
  sponsoredBy: {
    type: String,
  },
  budgetRange: {
    type: String,
  },
  kcoStatus: {
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

const Credentials = mongoose.Schema({
  type: {
    type: String,
  },
  password: {
    type: String,
  },
  email: {
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
    // Who created this student. Set SERVER-SIDE from the authenticated user.
    // Previously students.controller and the notification helpers referenced
    // `student.createdBy`, but the field was never declared -- strict mode
    // dropped it on write, so it was always undefined and ownership silently
    // degraded to the client-supplied `assignedTo`. Declaring it makes the
    // sub-agent ownership boundary real.
    //
    // NOT backfilled: students submitted before this deploy have no createdBy
    // and will not appear in their agent's list until reassigned.
    createdBy: { type: mongoose.SchemaTypes.ObjectId, ref: User },

    assignedTo: [
      {
        user: { type: mongoose.SchemaTypes.ObjectId, ref: User },
        role: { type: String, required: true },
        userRole: { type: mongoose.SchemaTypes.ObjectId, ref: 'Role' },
      },
    ],

    middleName: {
      type: String,
      trim: true,
    },
    backlogs: { type: Boolean },
    educationGaps: { type: Boolean },
    testScore: {
      type: String,
      trim: true,
    },
    testTaken: {
      type: String,
      enum: ['Yes', 'No', 'Waiting for results'],
    },
    gender: {
      type: String,
      enum: ['Male', 'Female', 'Others'],
    },
    stage: {
      type: String,
      // PendingReview / Denied drive the sub-agent submission review flow:
      // a sub-agent submits -> PendingReview; an admin/counselor approves ->
      // NotApplied (enters the normal pipeline) or denies -> Denied (+ denialReason).
      enum: ['NotApplied', 'Applied', 'Lost', 'Enrolled', 'PendingReview', 'Denied'],
      default: 'NotApplied',
    },

    // Completed study cycles. A student's record outlives a single journey:
    // someone who enrolled in a Bachelor's comes back three years later wanting
    // a Master's, and their history must not be overwritten to make room. When
    // a new journey starts, the CURRENT preference/stage/applications are
    // snapshotted here and the live fields reset -- so `stage`, `preference`
    // and `applications` always describe the journey in progress, and this
    // array is the past.
    journeys: [
      {
        startedAt: Date,
        closedAt: Date,
        // What the journey was for.
        degree: String,
        major: String,
        destination: String,
        intakeMonth: String,
        intakeYear: String,
        // How it ended: the stage at the moment it was closed
        // (Enrolled / Lost / Denied).
        outcome: String,
        // The Application documents that belonged to this cycle. They stay in
        // the applications collection; this is how the UI tells an old
        // journey's applications apart from the current one's.
        applications: [{ type: mongoose.SchemaTypes.ObjectId, ref: 'Application' }],
        // Who asked for the next journey (partner or staff).
        openedBy: { type: mongoose.SchemaTypes.ObjectId, ref: User },
      },
    ],

    // Reason + timestamp captured when an admin/counselor denies a sub-agent
    // submission (createdAt/updatedAt are stripped by the toJSON plugin, so we
    // persist the review time explicitly for the "Action needed" UI).
    denialReason: {
      type: String,
      trim: true,
    },
    reviewedAt: {
      type: Date,
    },

    residence: {
      type: Object,
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
    address: {
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
    },
    /**
     * Acquisition channel — what the dashboard's "Where students come from"
     * card counts. NOT the same thing as `source` above, which records the
     * brand (ulearn / uapply) and is often mistaken for this.
     *
     * Three values are set by the SYSTEM from who created the record and are
     * never offered in a form:
     *   subagent  — created through the sub-agent portal
     *   counselor — created through the school-counsellor portal
     *   lead      — converted from an online lead
     *
     * The rest are chosen by staff when adding a student in the back office.
     * `direct` stays the default and keeps its original meaning (walk-in), so
     * every record written before this list grew still reads correctly.
     */
    channel: {
      type: String,
      enum: ['subagent', 'counselor', 'lead', 'direct', 'exhibition', 'referral', 'campaign', 'other'],
      default: 'direct',
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
    // Passport detail captured by the school-counsellor intake form. Declared
    // explicitly because strict mode drops undeclared paths SILENTLY — the same
    // way docTypeKey was being lost before it was added.
    passportExpiry: { type: String, trim: true },
    passportIssueDate: { type: String, trim: true },
    civilNumber: { type: String, trim: true },
    placeOfIssue: { type: String, trim: true },
    placeOfBirth: { type: String, trim: true },

    passportNo: {
      type: String,
    },
    selectedUniversity: {
      type: Array,
    },
    status: {
      type: [String],
      enum: ['Missing documents', 'Missing IELTS'],
    },
    emergencyContact: {
      type: [EmergencyContact],
    },
    credentials: {
      type: [Credentials],
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
    // School counselors this student has been shared with (read-only). Distinct
    // from assignedTo — sharing grants visibility + a notification, not assignment.
    sharedWithCounselors: [
      {
        user: { type: mongoose.SchemaTypes.ObjectId, ref: 'User' },
        sharedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User' },
        sharedAt: { type: Date, default: Date.now },
      },
    ],
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
    // Put `createdAt` / `updatedAt` back on the wire.
    //
    // The shared toJSON plugin deletes both from every document, so the API
    // never sent a student's creation time and the back-office "Added" cell had
    // nothing to render. (Same gap as denialReason, which persists its own
    // review timestamp for exactly this reason.) Declared HERE rather than via
    // schema.set() after plugin(toJSON): the plugin captures any transform
    // already on the options and chains it after its own, whereas a later
    // set() would replace the plugin's transform outright and drop `id`.
    toJSON: {
      transform(doc, ret) {
        // eslint-disable-next-line no-param-reassign
        if (doc.createdAt) ret.createdAt = doc.createdAt;
        // eslint-disable-next-line no-param-reassign
        if (doc.updatedAt) ret.updatedAt = doc.updatedAt;
        return ret;
      },
    },
  }
);

// add plugin that converts mongoose to json
studentsSchema.plugin(toJSON);
studentsSchema.plugin(paginate);


// Performance indexes — the student list/dashboard filter and sort on these
// fields; without them every query is a full collection scan.
studentsSchema.index({ email: 1 });
studentsSchema.index({ 'assignedTo.user': 1 });
studentsSchema.index({ createdBy: 1, createdAt: -1 });
studentsSchema.index({ 'assignedTo.userRole': 1 });
studentsSchema.index({ stage: 1 });
studentsSchema.index({ createdAt: -1 });
studentsSchema.index({ stage: 1, createdAt: -1 });
studentsSchema.index({ previousSchool: 1 });
studentsSchema.index({ 'sharedWithCounselors.user': 1 });
studentsSchema.index({ channel: 1 });

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
