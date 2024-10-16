/* eslint-disable no-return-assign */
/* eslint-disable eqeqeq */
/* eslint-disable array-callback-return */
const httpStatus = require('http-status');
const { pick } = require('lodash');

const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');

const { countriesService } = require('../services');

const createCountry = catchAsync(async (req, res) => {
  const country = await countriesService.createCountry(req.body);

  res.status(httpStatus.CREATED).send(country);
});

const getCountries = catchAsync(async (req, res) => {
  // await publishMessage();
  const filter = pick(req.query, ['name', 'code']);
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'populate']);
  const result = await countriesService.queryCountries(filter, options);
  res.send(result);
});

const getCountry = catchAsync(async (req, res) => {
  const country = await countriesService.getCountryById(req.params.countryId);

  if (!country) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Country not found');
  }
  res.send(country);
});

const updateCountry = catchAsync(async (req, res) => {
  const country = await countriesService.updateCountryById(req.params.countryId, req.body);

  res.send(country);
});

const deleteCountry = catchAsync(async (req, res) => {
  await countriesService.deleteCountryById(req.params.countryId);
  res.status(httpStatus.NO_CONTENT).send();
});

const searchCountries = catchAsync(async (req, res) => {
  // const filter = pick(req.query, ['name', 'status', 'stage']);
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'populate']);
  const results = await countriesService.searchCountry(req.params.text, options);
  res.status(200).send(results);
});

module.exports = {
  createCountry,
  getCountry,
  getCountries,
  deleteCountry,
  updateCountry,
  searchCountries,
};
