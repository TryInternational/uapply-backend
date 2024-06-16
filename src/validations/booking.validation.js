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
    modeOfPayment: Joi.string().required(),
    price: Joi.number().required(),
    countryCode: Joi.string().required(),
    alternateCountryCode: Joi.string().required(),
    packageType: Joi.string().required(),
    notes: Joi.string(),
    civilId: Joi.string().required(),
    signature: Joi.string().required(),
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
      email: Joi.string().required().email(),
      startDate: Joi.date().required(),
      endDate: Joi.date().required(),
      modeOfPayment: Joi.string().required(),
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
  getBookings,
  getBooking,
  updateBooking,
  deleteBooking,
};
