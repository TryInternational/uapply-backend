const httpStatus = require('http-status');
const { Education } = require('../models');
const ApiError = require('../utils/ApiError');

/**
 * Create a role
 * @param {Object} roleBody
 * @returns {Promise<Education>}
 */
const createStudentEducation = async (roleBody) => {
  const role = await Education.create(roleBody);
  return role;
};

/**
 * Query for Education
 * @param {Object} filter - Mongo filter
 * @param {Object} options - Query options
 * @param {string} [options.sortBy] - Sort option in the format: sortField:(desc|asc)
 * @param {number} [options.limit] - Maximum number of results per page (default = 10)
 * @param {number} [options.page] - Current page (default = 1)
 * @returns {Promise<QueryResult>}
 */
const queryStudentEducation = async (filter, options) => {
  const education = await Education.paginate(filter, options);
  return education;
};

/**
 * Get role by id
 * @param {ObjectId} id
 * @returns {Promise<Education>}
 */
const getStudentEducationById = async (id) => {
  return Education.findById(id);
};

/**
 * Update role by id
 * @param {ObjectId} id
 * @param {Object} updateBody
 * @returns {Promise<Education>}
 */
const updateStudentEducationById = async (id, updateBody) => {
  const role = await getStudentEducationById(id);
  if (!role) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Education not found');
  }
  Object.assign(role, updateBody);
  await role.save();
  return role;
};

/**
 * Delete role by id
 * @param {ObjectId} roleId
 * @returns {Promise<Education>}
 */
const deleteStudentEducationById = async (educationId) => {
  const education = await getStudentEducationById(educationId);
  if (!education) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Education not found');
  }
  await education.remove();
  return education;
};

module.exports = {
  createStudentEducation,
  queryStudentEducation,
  getStudentEducationById,
  updateStudentEducationById,
  deleteStudentEducationById,
};
