const httpStatus = require('http-status');
const { Payment } = require('../models');
const ApiError = require('../utils/ApiError');

/**
 * Create a payment
 * @param {Object} paymentBody
 * @returns {Promise<Payment>}
 */
const createPayment = async (paymentBody) => {
  const payment = await Payment.create(paymentBody);
  return payment;
};

/**
 * Query for payments
 * @param {Object} filter - Mongo filter
 * @param {Object} options - Query options
 * @param {string} [options.sortBy] - Sort option in the format: sortField:(desc|asc)
 * @param {number} [options.limit] - Maximum number of results per page (default = 10)
 * @param {number} [options.page] - Current page (default = 1)
 * @returns {Promise<QueryResult>}
 */
const queryPayments = async (filter, options) => {
  const payments = await Payment.paginate(filter, options);
  return payments;
};

/**
 * Get payment by id
 * @param {ObjectId} id
 * @returns {Promise<User>}
 */
const getPaymentById = async (id) => {
  return Payment.findById(id);
};

const getPaymentByTxnId = async (id) => {
  return Payment.findOne({ transactionId: id });
};

/**
 * Update payment by id
 * @param {ObjectId} id
 * @param {Object} updateBody
 * @returns {Promise<User>}
 */
const updatePaymentById = async (id, updateBody) => {
  const payment = await getPaymentById(id);
  if (!payment) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Payment not found');
  }
  Object.assign(payment, updateBody);
  await payment.save();
  return payment;
};

/**
 * Delete payment by id
 * @param {ObjectId} paymentId
 * @returns {Promise<User>}
 */
const deletePaymentById = async (paymentId) => {
  const payment = await getPaymentById(paymentId);
  if (!payment) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Payment not found');
  }
  await payment.remove();
  return payment;
};

module.exports = {
  createPayment,
  queryPayments,
  getPaymentById,
  updatePaymentById,
  deletePaymentById,
  getPaymentByTxnId,
};
