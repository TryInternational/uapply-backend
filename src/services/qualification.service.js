const httpStatus = require('http-status');
const { Qualification } = require('../models');
const ApiError = require('../utils/ApiError');

/**
 * Create a role
 * @param {Object} qualificationBody
 * @returns {Promise<Qualification>}
 */
const createQualification = async (qualificationBody) => {
  const qualification = await Qualification.create(qualificationBody);
  return qualification;
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
const queryQualifications = async (filter, options) => {
  const qualifications = await Qualification.paginate(filter, options);
  return qualifications;
};

/**
 * Get role by id
 * @param {ObjectId} id
 * @returns {Promise<Qualification>}
 */
const getQualificationById = async (id) => {
  return Qualification.findById(id);
};

/**
 * Update role by id
 * @param {ObjectId} id
 * @param {Object} updateBody
 * @returns {Promise<Qualification>}
 */
const updateQualificationById = async (id, updateBody) => {
  const qualifications = await getQualificationById(id);
  if (!qualifications) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Qualifications not found');
  }
  Object.assign(qualifications, updateBody);
  await qualifications.save();
  return qualifications;
};

/**
 * Delete role by id
 * @param {ObjectId} roleId
 * @returns {Promise<Roles>}
 */
const deleteQualificationById = async (id) => {
  const qualifications = await getQualificationById(id);
  if (!qualifications) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Roles not found');
  }
  await qualifications.remove();
  return qualifications;
};

module.exports = {
  createQualification,
  queryQualifications,
  getQualificationById,
  updateQualificationById,
  deleteQualificationById,
};
