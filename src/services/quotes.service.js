const httpStatus = require('http-status');
const { Quotes } = require('../models');
const ApiError = require('../utils/ApiError');

const createQuote = async (body) => {
  const quote = await Quotes.create(body);
  return quote;
};

const queryQuote = async (filter, options) => {
  const quotes = await Quotes.paginate(filter, options);
  return quotes;
};

const getQuoteById = async (id) => {
  return Quotes.findById(id);
};

const updateQuoteById = async (id, updateBody) => {
  const quote = await getQuoteById(id);
  if (!quote) {
    throw new ApiError(httpStatus.NOT_FOUND, 'quote not found');
  }
  Object.assign(quote, updateBody);
  await quote.save();
  return quote;
};

const deleteQuoteById = async (id) => {
  const quote = await getQuoteById(id);
  if (!quote) {
    throw new ApiError(httpStatus.NOT_FOUND, 'quote not found');
  }
  await quote.remove();
  return quote;
};

module.exports = {
  createQuote,
  queryQuote,
  getQuoteById,
  updateQuoteById,
  deleteQuoteById,
};
