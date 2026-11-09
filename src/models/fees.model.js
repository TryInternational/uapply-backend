const mongoose = require('mongoose');
const { toJSON, paginate } = require('./plugins');

const feesSchema = mongoose.Schema(
  {
    tag: {
      type: Object,
    },
    feeType: {
      type: String,
      enum: ['ielts-booking', 'office-fees', 'student-visa', 'english-self-funded'],
    },
    createdDate: {
      type: Date,
    },
    // The student this payment belongs to. Optional: fees recorded before the
    // profile's "Payments & services" card existed carry only tag.studentName,
    // and GET /fees?student= falls back to that name.
    student: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Students',
    },
  },
  {
    timestamps: true,
  }
);

// add plugin that converts mongoose to json
feesSchema.plugin(toJSON);
feesSchema.plugin(paginate);

// Performance index — fees stats aggregations match/sort on creation date.
feesSchema.index({ createdAt: -1 });
feesSchema.index({ student: 1 });
// Every fee list, count and dashboard card filters on the fee type first
// (office-fees / student-visa / …), then by date.
feesSchema.index({ feeType: 1, createdAt: -1 });
feesSchema.index({ feeType: 1, createdDate: -1 });

/**
 * Check if password matches the user's password
 * @returns {Promise<boolean>}
 */

/**
 * @typedef fees
 */
const Fees = mongoose.model('Fees', feesSchema);

module.exports = Fees;
