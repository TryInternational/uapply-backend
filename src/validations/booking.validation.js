const Joi = require('joi');
const { objectId } = require('./custom.validation');

const createBooking = {
  body: Joi.object().keys({
    fullname: Joi.string().required(),
    phoneNo: Joi.string().required(),
    alternatePhoneNo: Joi.string().required(),
    email: Joi.string().required().email(),
    startDate: Joi.date().required(),
    endDate: Joi.date().required(),
    modeOfPayment: Joi.string(),
    price: Joi.number().required(),
    countryCode: Joi.string().required(),
    alternateCountryCode: Joi.string().required(),
    packageType: Joi.string().required(),
    notes: Joi.string(),
    civilId: Joi.string().required(),
    signature: Joi.string().required(),
    formOfPayment: Joi.string().required(),
    actualAmount: Joi.number().min(0).allow(null),
    amountNote: Joi.string().allow(''),
  }),
};

const updateDeposit = {
  params: Joi.object().keys({
    bookingId: Joi.required().custom(objectId),
  }),
  body: Joi.object().keys({
    status: Joi.string().valid('collected', 'returned', 'waived').required(),
    amount: Joi.number().min(0).allow(null),
    note: Joi.string().allow('', null),
  }),
};

const getBookings = {};

const getBooking = {
  params: Joi.object().keys({
    bookingId: Joi.string().custom(objectId),
  }),
};

const updateBooking = {
  params: Joi.object().keys({
    bookingId: Joi.required().custom(objectId),
  }),
  body: Joi.object()
    .keys({
      fullname: Joi.string().required(),
      phoneNumber: Joi.string().required(),
    })
    .min(1),
};

const deleteBooking = {
  params: Joi.object().keys({
    bookingId: Joi.string().custom(objectId),
  }),
};

module.exports = {
  createBooking,
  updateDeposit,
  getBookings,
  getBooking,
  updateBooking,
  deleteBooking,
};
