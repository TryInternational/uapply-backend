const httpStatus = require('http-status');
const { Countries } = require('../models');
const ApiError = require('../utils/ApiError');

/**
 * Create a booking
 * @param {Object} countryBody
 * @returns {Promise<Country>}
 */
const createCountries = async (countryBody) => {
  const country = await Countries.create(countryBody);
  return country;
};

/**
 * Query for bookings
 * @param {Object} _filter - Mongo filter
 * @param {Object} options - Query options
 * @param {string} [options.sortBy] - Sort option in the format: sortField:(desc|asc)
 * @param {number} [options.limit] - Maximum number of results per page (default = 10)
 * @param {number} [options.page] - Current page (default = 1)
 * @returns {Promise<QueryResult>}
 */
const queryCountries = async (filter, options) => {
  const country = await Countries.paginate(filter, options);
  return country;
};

/**
 * @param {ObjectId} id
 * @returns {Promise<User>}
 */
const getCountryById = async (id) => {
  return Countries.findById(id);
};

/**
 * Update booking by id
 * @param {ObjectId} id
 * @param {Object} updateBody
 * @returns {Promise<User>}
 */
const updateCountryById = async (id, updateBody) => {
  const country = await getCountryById(id);
  if (!country) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Country not found');
  }
  Object.assign(country, updateBody);
  await country.save();
  return country;
};

/**
 * Delete booking by id
 * @param {ObjectId} countryId
 * @returns {Promise<User>}
 */
const deleteCountryById = async (countryId) => {
  const country = await getCountryById(countryId);
  if (!country) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Country not found');
  }
  await country.remove();
  return country;
};

/**
 * Delete booking by id
 * @param {ObjectId} countryId
 * @param {Object} commentBody
 * @returns {Promise<Comment>}
 */

const searchCountry = async (text, options) => {
  // eslint-disable-next-line security/detect-non-literal-regexp
  const regex = new RegExp(text, 'i');
  const country = await Countries.paginate({ $or: [{ english_name: regex }, { arabic_name: regex }] }, options);
  return country;
};

module.exports = {
  createCountries,
  queryCountries,
  getCountryById,
  updateCountryById,
  deleteCountryById,
  searchCountry,
};
