const Joi = require('joi');
const { objectId } = require('./custom.validation');

const getPaymentMethods = {
  body: Joi.object().keys({
    InvoiceAmount: Joi.number().required(),
    paymentId: Joi.string().required().custom(objectId),
  }),
};

const getPayments = {
  query: Joi.object().keys({
    name: Joi.string(),
    subject: Joi.string().required().custom(objectId),
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
    populate: Joi.string(),
  }),
};

const getPayment = {
  params: Joi.object().keys({
    paymentId: Joi.string().custom(objectId),
  }),
};

const updatePayment = {
  params: Joi.object().keys({
    paymentId: Joi.required().custom(objectId),
  }),
  body: Joi.object()
    .keys({
      name: Joi.string(),
      subject: Joi.string().custom(objectId),
      // options: Joi.array().items(options),
    })
    .min(1),
};

const deletePayment = {
  params: Joi.object().keys({
    paymentId: Joi.string().custom(objectId),
  }),
};

const requestRefund = {
  params: Joi.object().keys({
    paymentId: Joi.string().custom(objectId),
  }),
  body: Joi.object()
    .keys({
      comment: Joi.string(),
    })
    .min(1),
};

module.exports = {
  getPaymentMethods,
  getPayments,
  getPayment,
  updatePayment,
  deletePayment,
  requestRefund,
};
