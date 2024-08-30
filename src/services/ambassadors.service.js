const httpStatus = require('http-status');
const { Ambassadors } = require('../models');
const ApiError = require('../utils/ApiError');

/**
 * Create a role
 * @param {Object} roleBody
 * @returns {Promise<ambassador>}
 */
const createAmbassador = async (roleBody) => {
  const ambassador = await Ambassadors.create(roleBody);
  return ambassador;
};

/**
 * Query for roles
 * @param {Object} filter - Mongo filter
 * @param {Object} options - Query options
 * @param {string} [options.sortBy] - Sort option in the format: sortField:(desc|asc)
 * @param {number} [options.limit] - Maximum number of results per page (default = 10)
 * @param {number} [options.page] - Current page (default = 1)
 * @returns {Promise<QueryResult>}
 */
const queryAmbassadors = async (filter, options) => {
  const ambassador = await Ambassadors.paginate(filter, options);
  return ambassador;
};

/**
 * Get role by id
 * @param {ObjectId} id
 * @returns {Promise<Discipline>}
 */
const getAmbassadorById = async (id) => {
  return Ambassadors.findById(id);
};

/**
 * Update role by id
 * @param {ObjectId} id
 * @param {Object} updateBody
 * @returns {Promise<ambassador>}
 */
const updateAmbassadorById = async (id, updateBody) => {
  const ambassador = await getAmbassadorById(id);
  if (!ambassador) {
    throw new ApiError(httpStatus.NOT_FOUND, 'ambassador not found');
  }
  Object.assign(ambassador, updateBody);
  await ambassador.save();
  return ambassador;
};

/**
 * Delete role by id
 * @param {ObjectId} roleId
 * @returns {Promise<Discipline>}
 */
const deleteAmbassadorById = async (roleId) => {
  const ambassador = await getAmbassadorById(roleId);
  if (!ambassador) {
    throw new ApiError(httpStatus.NOT_FOUND, 'ambassador not found');
  }
  await ambassador.remove();
  return ambassador;
};

module.exports = {
  createAmbassador,
  queryAmbassadors,
  getAmbassadorById,
  updateAmbassadorById,
  deleteAmbassadorById,
};
