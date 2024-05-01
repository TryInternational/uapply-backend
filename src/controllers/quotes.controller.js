const httpStatus = require('http-status');
const { pick } = require('lodash');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');
const { quotesService } = require('../services');

const createQuotes = catchAsync(async (req, res) => {
  const quote = await quotesService.createQuote(req.body);
  res.status(httpStatus.CREATED).send(quote);
});

const getQuotes = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['name', 'slug', 'visibility']);
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'populate']);
  const result = await quotesService.queryQuote(filter, options);
  res.send(result);
});

const getQuote = catchAsync(async (req, res) => {
  const quote = await quotesService.getQuoteById(req.params.id);
  if (!quote) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Role not found');
  }
  res.send(quote);
});

const updateQuotes = catchAsync(async (req, res) => {
  const quote = await quotesService.updateQuoteById(req.params.id, req.body);
  res.send(quote);
});

const deleteQuote = catchAsync(async (req, res) => {
  await quotesService.deleteQuoteById(req.params.id);
  res.status(httpStatus.NO_CONTENT).send();
});

module.exports = {
  createQuotes,
  getQuotes,
  getQuote,
  updateQuotes,
  deleteQuote,
};
