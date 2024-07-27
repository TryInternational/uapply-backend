const axios = require('axios');
const config = require('../config/config');

const api = axios.create({
  baseURL: config.fatoorah.url,
  headers: {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.fatoorah.key}`,
  },
});

const executePayment = async ({
  PaymentMethodId,
  CustomerName,
  DisplayCurrencyIso,
  MobileCountryCode,
  CustomerMobile,
  CustomerEmail,
  InvoiceValue,
  Language = 'AR',
}) => {
  const apiUrl = `${config.host}/payments`;

  const payload = {
    PaymentMethodId,
    CustomerName,
    DisplayCurrencyIso,
    MobileCountryCode,
    CustomerMobile,
    CustomerEmail,
    InvoiceValue,
    Language,
    CallBackUrl: `${apiUrl}/redirect/confirm`,
    ErrorUrl: `${apiUrl}/redirect/error`,
  };

  const resp = await api.post('/ExecutePayment', payload);
  return resp.data.Data;
};

/**
 * initiate payment
 * @param {String} CurrencyIso
 * @param {Number} InvoiceAmount
 */
const initiatePayment = async ({ CurrencyIso, InvoiceAmount }) => {
  const resp = await api.post('/InitiatePayment', {
    InvoiceAmount,
    CurrencyIso,
  });

  return resp.data.Data.PaymentMethods;
};

/**
 * get payment details
 * @param {String} Key
 */

const getPaymentStatus = async (Key) => {
  const resp = await api.post('/GetPaymentStatus', {
    KeyType: 'PaymentId',
    Key,
  });
  return resp.data.Data;
};

const requestRefund = async ({ Key, RefundChargeOnCustomer, ServiceChargeOnCustomer, Amount, Comment }) => {
  const resp = await api.post('/MakeRefund', {
    KeyType: 'InvoiceId',
    Key,
    RefundChargeOnCustomer,
    ServiceChargeOnCustomer,
    Amount,
    Comment,
  });
  return resp.data.Data;
};

module.exports = {
  initiatePayment,
  executePayment,
  getPaymentStatus,
  requestRefund,
};
