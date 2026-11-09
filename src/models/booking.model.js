const mongoose = require('mongoose');
const AutoIncrement = require('mongoose-sequence')(mongoose);

const { toJSON, paginate, slug, trackable } = require('./plugins');

const bookingSchema = new mongoose.Schema(
  {
    fullname: { type: String, required: true },
    phoneNo: { type: String, required: true },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    status: { type: String, enum: ['booked', 'pending', 'cancelled'], default: 'pending' },
    alternatePhoneNo: { type: String, required: true },
    paymentId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Payment',
    },
    countryCode: {
      type: String,
      trim: true,
    },
    documents: {
      type: Array,
    },
    couponCode: {
      type: String,
      trim: true,
    },
    insuranceReturned: {
      type: Boolean,
      default: false,
    },

    /**
     * Money actually received for the stay, excluding the refundable
     * deposit. Set on every manual (back-office) booking; left null on
     * bookings taken through the website, where `price` is what the
     * guest paid online. Revenue reporting reads this first and only
     * falls back to `price - DEPOSIT_KWD` when it is null, so a
     * discounted or free stay reports what it really earned.
     */
    actualAmount: {
      type: Number,
      default: null,
      min: 0,
    },

    /** Free-text reason for the actual amount (discount, gift, staff stay…). */
    amountNote: {
      type: String,
      trim: true,
    },

    /* --- Refundable security deposit ------------------------------- */
    depositStatus: {
      type: String,
      enum: ['collected', 'returned', 'waived'],
      default: 'collected',
    },
    depositAmount: {
      type: Number,
      default: 200,
      min: 0,
    },
    depositReturnedAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    depositReturnedAt: {
      type: Date,
    },
    depositNote: {
      type: String,
      trim: true,
    },
    blocked: {
      type: Boolean,
      default: false,
    },
    formOfPayment: {
      type: String,
      trim: true,
    },
    notes: {
      type: String,
      trim: true,
    },
    packageType: {
      type: String,
      trim: true,
    },
    alternateCountryCode: {
      type: String,
      trim: true,
    },
    signature: {
      type: String,
      trim: true,
      // required: true,
    },
    civilId: {
      type: String,
      trim: true,
      // required: true,
    },
    modeOfPayment: {
      type: String,
      trim: true,
    },

    price: { type: Number, required: true },
    startDate: { type: Date, default: Date.now },
    returnDate: { type: Date },
    endDate: { type: Date, default: Date.now },
    // userId: { type: mongoose.SchemaTypes.ObjectId, ref: 'Users', autopopulate: true },
  },
  {
    timestamps: true,
  }
);

bookingSchema.plugin(toJSON);
bookingSchema.plugin(paginate);
bookingSchema.plugin(slug);
bookingSchema.plugin(trackable);
bookingSchema.plugin(AutoIncrement, { inc_field: 'orderNo' });

// Performance indexes — booking availability + email lookups.
bookingSchema.index({ status: 1, blocked: 1 });
bookingSchema.index({ email: 1 });
bookingSchema.index({ depositStatus: 1 });
bookingSchema.index({ startDate: 1, endDate: 1 });

module.exports = mongoose.model('Booking', bookingSchema);
