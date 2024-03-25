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
      unique: true,
      trim: true,
      lowercase: true,
    },
    paymentId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Payment',
    },
    countryCode: {
      type: String,
      trim: true,
    },
    guest: {
      adult: { type: Number, required: true },
      children: { type: Number, required: true },
    },
    price: { type: Number, required: true },
    startDate: { type: Date, default: Date.now },
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
