const httpStatus = require('http-status');
// const moment = require('moment');
const moment = require('moment-timezone');
const axios = require('axios');

// const { pick } = require('lodash');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');
const { paymentService, bookingService, emailService } = require('../services');
const { fatoorah, googlesheet } = require('../thirdparty');
const config = require('../config/config');

const getPaymentMethods = catchAsync(async (req, res) => {
  const payment = await fatoorah.initiatePayment({
    InvoiceAmount: req.query.InvoiceAmount,
    CurrencyIso: req.query.currency,
  });

  const filter = {
    KWD: [1, 2],
    SAR: [4, 2],
  };

  const selected = filter[req.query.currency] || [1, 2];

  const local = payment.find((a) => a.PaymentMethodId === selected[0]);
  const masterCard = payment.find((a) => a.PaymentMethodId === selected[1]);
  res.status(httpStatus.OK).send([local, masterCard]);
});

const error = catchAsync(async (req, res) => {
  return res.redirect(`${config.website}/booking/failed?id=${null}`);
});

const requestRefund = catchAsync(async (req, res) => {
  const payment = await paymentService.getPaymentById(req.params.paymentId);
  if (!payment) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Payment not found');
  }

  if (payment.status === 'Refunded') {
    throw new ApiError(httpStatus.NOT_FOUND, 'Booking has been refunded already');
  }
  await fatoorah.requestRefund({
    Key: payment.transactionId,
    RefundChargeOnCustomer: false,
    ServiceChargeOnCustomer: false,
    Amount: payment.amount,
    Comment: req.body.comment,
  });

  payment.status = 'Refunded';

  await payment.save();

  return res.send(payment);
});

const confirm = catchAsync(async (req, res) => {
  console.log(req.query);
  const transaction = await fatoorah.getPaymentStatus(req.query.paymentId);
  if (!transaction) {
    return res.redirect(`${config.website}/booking/failed?id=${null}`);
  }
  const payment = await paymentService.getPaymentByTxnId(transaction.InvoiceId);
  console.log('payment', payment);
  if (!payment) {
    return res.redirect(`${config.website}/booking/failed?id=${null}`);
  }

  const booking = await bookingService.getBookingById(payment.bookingId);

  payment.status = transaction.InvoiceStatus;
  payment.meta = transaction;
  booking.status = transaction.InvoiceStatus;
  await payment.save();
  await booking.save();
  if (transaction.InvoiceStatus === 'Paid') {
    // const paymentImg =
    //   payment.paymentMode === 'KNET'
    //     ? 'https://storage.googleapis.com/destination_ulearn/courses/Frame%201680.png'
    //     : 'https://storage.googleapis.com/destination_ulearn/courses/mastercard.png';

    // TODO: ADD context for email
    // const context = {
    //   ...booking.toObject(),
    //   createdAt: moment(new Date(booking.createdAt)).tz('Asia/Kuwait').format('MMM DD YYYY'),
    //   orderNo: booking.orderNo,
    //   paymentMode: payment.paymentMode,
    //   paymentModeImg: paymentImg,

    //   totalPrice: booking.price,

    //   currency: 'KWD',
    //   discount: false,
    //   email: booking.email,
    //   endDate: moment(new Date(booking.endDate)).tz('Asia/Kuwait').format('MMM DD YYYY'),
    //   startDate: moment(new Date(booking.startDate)).tz('Asia/Kuwait').format('MMM DD YYYY'),
    //   time: booking.localTime,

    //   year: moment().year(),
    // };

    // const payload = {
    //   'Order #': `W${booking.orderNo}`,
    //   'Date of Booking': moment(booking.createdAt).tz('Asia/Kuwait').format('MMM DD YYYY [at] hh:mm a'),
    //   'Start Date': moment(new Date(booking.courseStartDate)).tz('Asia/Kuwait').format('MMM DD YYYY'),
    //   'End Date': moment(new Date(booking.courseEndDate)).tz('Asia/Kuwait').format('MMM DD YYYY'),
    //   'Full Name': booking.fullname,
    //   'Mobile #': booking.phoneNumber,

    //   Email: booking.email,

    //   'Original Amount(KD)': booking.price,
    //   'Amount Paid': booking.price,
    //   'Payment Method': payment.paymentMode,
    // };

    // await googlesheet.addRow(config.googlesheet.booking, payload);
    // await emailService.sendReceipt(booking.email, context);

    return res.redirect(`${config.website}/booking/success?id=${booking._id}`);
  }

  if (transaction.InvoiceStatus !== 'Paid') {
    return res.redirect(`${config.website}/booking/failed?id=${booking.id}`);
  }

  // await emailService.sendReceipt('elasoshi@gmail.com');
});
const getPayment = catchAsync(async (req, res) => {
  const payment = await paymentService.getPaymentById(req.params.paymentId);

  if (!payment) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Payment not found');
  }
  res.send(payment);
});
module.exports = {
  getPaymentMethods,
  error,
  confirm,
  requestRefund,
  getPayment,
};
