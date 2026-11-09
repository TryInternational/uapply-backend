const mongoose = require('mongoose');
const validator = require('validator');
const bcrypt = require('bcryptjs');
const { toJSON, paginate } = require('./plugins');

const userSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      validate(value) {
        if (!validator.isEmail(value)) {
          throw new Error('Invalid email');
        }
      },
    },
    slackMemberId: {
      type: String,
    },
    // The partner organisation this user belongs to — a school for a school
    // counsellor, an agency for a sub-agent. Denormalised from their access
    // request at approval time so the portal nav can name it; the User model
    // otherwise has no link back to the request.
    organisation: {
      type: String,
      trim: true,
    },
    avatar: {
      type: String,
    },
    // The partner ORGANISATION's logo (an agency's, a school's) -- not this
    // person's photo, which is `avatar`. Staff upload it from the partner
    // directory; the file itself lives in storage, this holds the URL. Kept on
    // the user because `organisation` is, for the same reason: there is no
    // Partner model to hang either on.
    organisationLogo: {
      type: String,
      trim: true,
    },
    // The access request this partner account was provisioned from. Reviewers
    // and the partner directory read the organisation paperwork (and the Civil
    // ID scan) from there rather than copying every field onto the account.
    accessRequest: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'AccessRequest',
    },
    // The completed sub-agent agreement this partner works under.
    agreement: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Agreement',
    },
    // A read-mostly copy of what the partner told us about their organisation
    // when they asked for access, so the portal's "My account" and the partner
    // directory can show it without a second lookup. Only on partner accounts.
    partnerProfile: {
      nameAr: { type: String, trim: true },
      organisationAr: { type: String, trim: true },
      title: { type: String, trim: true },
      legalName: { type: String, trim: true },
      yearEstablished: { type: Number },
      address: { type: String, trim: true },
      noOffice: { type: Boolean },
      country: { type: String, trim: true },
      city: { type: String, trim: true },
      website: { type: String, trim: true },
      staffCount: { type: String, trim: true },
      studentsPerYear: { type: String, trim: true },
      destinations: { type: [String], default: undefined },
      services: { type: String, trim: true },
      socialMedia: { type: String, trim: true },
      personInCharge: {
        name: { type: String, trim: true },
        nameAr: { type: String, trim: true },
        title: { type: String, trim: true },
        email: { type: String, trim: true },
        phoneCode: { type: String, trim: true },
        phone: { type: String, trim: true },
      },
    },
    // A partner's rating of the Ulearn portal ("My account › Rate your
    // experience"): 1–5, 0 = not rated. `feedback` is what they would fix,
    // asked for when the rating is low. Optional, so existing users read fine.
    rating: {
      type: Number,
      min: 0,
      max: 5,
    },
    feedback: {
      type: String,
      trim: true,
      maxlength: 2000,
    },
    ratedAt: {
      type: Date,
    },
    password: {
      type: String,
      required: true,
      trim: true,
      minlength: 8,
      validate(value) {
        if (!value.match(/\d/) || !value.match(/[a-zA-Z]/)) {
          throw new Error('Password must contain at least one letter and one number');
        }
      },
      private: true, // used by the toJSON plugin
    },
    role: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Roles',
      // NO DEFAULT. This used to default to 63c92057dab279194bab8d8f, an ADMIN
      // role id — so any code path that created a user without naming a role
      // produced an administrator. POST /auth/register is public and its Joi
      // schema accepts only name/email/password, which made that a way in.
      //
      // A user with no role now fails every gate rather than passing all of
      // them: services/roleAccess.service.js answers false for an empty role,
      // so the failure mode is a powerless account instead of a silent admin.
      // Every legitimate creation path names a role explicitly — user.validation
      // requires it, and provisionUserForRequest resolves it through
      // roleIdForRequestedRole.
      //
      // `autopopulate: true` is a no-op and always has been: mongoose-autopopulate
      // is imported in models/plugins.js but never registered on this schema, so
      // `user.role` is a bare ObjectId everywhere. Left in place because removing
      // it changes nothing and several comments still reference it.
      autopopulate: true,
    },
    // isEmailVerified: {
    //   type: Boolean,
    //   default: false,
    // },
  },
  {
    timestamps: true,
  }
);

// add plugin that converts mongoose to json
userSchema.plugin(toJSON);
userSchema.plugin(paginate);

/**
 * Check if email is taken
 * @param {string} email - The user's email
 * @param {ObjectId} [excludeUserId] - The id of the user to be excluded
 * @returns {Promise<boolean>}
 */
userSchema.statics.isEmailTaken = async function (email, excludeUserId) {
  const user = await this.findOne({ email, _id: { $ne: excludeUserId } });
  return !!user;
};

/**
 * Check if password matches the user's password
 * @param {string} password
 * @returns {Promise<boolean>}
 */
userSchema.methods.isPasswordMatch = async function (password) {
  const user = this;
  return bcrypt.compare(password, user.password);
};

userSchema.pre('save', async function (next) {
  const user = this;
  if (user.isModified('password')) {
    user.password = await bcrypt.hash(user.password, 8);
  }
  next();
});

/**
 * @typedef User
 */
const User = mongoose.model('User', userSchema);

module.exports = User;
