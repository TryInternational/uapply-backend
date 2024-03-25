const mongoose = require('mongoose');
const { toJSON, paginate, slug } = require('./plugins');

const paymentSchema = mongoose.Schema(
  {
    amount: {
      type: Number,
    },
    bookingId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Booking',
    },
    transactionId: {
      type: String,
    },
    meta: {
      type: Object,
      default: {},
    },
    paymentMode: {
      type: String,
    },
    orderNo: {
      type: Number,
    },
    status: {
      type: String,
      enum: ['Paid', 'Pending', 'Failed', 'PartiallyPaid', 'Canceled', 'Refunded'],
    },
  },
  {
    timestamps: true,
  }
);

// add plugin that converts mongoose to json
paymentSchema.plugin(toJSON);
paymentSchema.plugin(paginate);
paymentSchema.plugin(slug);

/**
 * @typedef Payment
 */
const Payment = mongoose.model('Payment', paymentSchema);

module.exports = Payment;
