const httpStatus = require('http-status');
const { WorkExperience } = require('../models');
const ApiError = require('../utils/ApiError');

/**
 * Create a workExp
 * @param {Object} roleBody
 * @returns {Promise<WorkExperience>}
 */
const createWorkExperience = async (roleBody) => {
  const workExp = await WorkExperience.create(roleBody);
  return workExp;
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
const queryWorkExperience = async (filter, options) => {
  const experience = await WorkExperience.paginate(filter, options);
  return experience;
};

/**
 * Get workExp by id
 * @param {ObjectId} id
 * @returns {Promise<Education>}
 */
const getWorkExperienceById = async (id) => {
  return WorkExperience.findById(id);
};

/**
 * Update workExp by id
 * @param {ObjectId} id
 * @param {Object} updateBody
 * @returns {Promise<WorkExperience>}
 */
const updateWorkExperienceById = async (id, updateBody) => {
  const workExp = await getWorkExperienceById(id);
  if (!workExp) {
    throw new ApiError(httpStatus.NOT_FOUND, 'WorkExperience not found');
  }
  Object.assign(workExp, updateBody);
  await workExp.save();
  return workExp;
};

/**
 * Delete workExp by id
 * @param {ObjectId} workExpId
 * @returns {Promise<Education>}
 */
const deleteWorkExperienceById = async (workExpId) => {
  const workExp = await getWorkExperienceById(workExpId);
  if (!workExp) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Education not found');
  }
  await workExp.remove();
  return workExp;
};

module.exports = {
  createWorkExperience,
  queryWorkExperience,
  getWorkExperienceById,
  updateWorkExperienceById,
  deleteWorkExperienceById,
};
