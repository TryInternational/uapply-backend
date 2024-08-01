const mongoose = require('mongoose');
const AutoIncrement = require('mongoose-sequence')(mongoose);

const { toJSON, paginate, slug, mongooseHistory } = require('./plugins');

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
    couponCode: {
      type: String,
      trim: true,
    },
    insuranceReturned: {
      type: Boolean,
      default: false,
    },
    blocked: {
      type: Boolean,
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
      required: true,
    },
    civilId: {
      type: String,
      trim: true,
      required: true,
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
bookingSchema.plugin(mongooseHistory);
bookingSchema.plugin(AutoIncrement, { inc_field: 'orderNo' });

module.exports = mongoose.model('Booking', bookingSchema);
