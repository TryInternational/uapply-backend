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
  const transaction = await fatoorah.getPaymentStatus(req.query.paymentId);
  if (!transaction) {
    return res.redirect(`${config.website}/booking/failed?id=${null}`);
  }
  const payment = await paymentService.getPaymentByTxnId(transaction.InvoiceId);
  if (!payment) {
    return res.redirect(`${config.website}/booking/failed?id=${null}`);
  }

  const booking = await bookingService.getBookingById(payment.bookingId);

  payment.status = transaction.InvoiceStatus;
  payment.meta = transaction;
  booking.status = transaction.InvoiceStatus === 'Paid' ? 'booked' : 'cancelled';

  await payment.save();
  await booking.save();
  if (transaction.InvoiceStatus === 'Paid') {
    return res.redirect(`${config.website}/booking/success?id=${booking._id}`);
  }

  if (transaction.InvoiceStatus !== 'Paid') {
    return res.redirect(`${config.website}/booking/failed?id=${booking.id}`);
  }
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
