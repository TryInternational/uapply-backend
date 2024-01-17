const httpStatus = require('http-status');
const { SponsorStudent } = require('../models');
const ApiError = require('../utils/ApiError');

/**
 * Create a role
 * @param {Object} roleBody
 * @returns {Promise<SponsorStudent>}
 */
const createSponsorStudent = async (roleBody) => {
  const sponsorStudent = await SponsorStudent.create(roleBody);
  return sponsorStudent;
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
const querySponsorStudents = async (filter, options) => {
  const sponsorStudent = await SponsorStudent.paginate(filter, options);
  return sponsorStudent;
};

/**
 * Get role by id
 * @param {ObjectId} id
 * @returns {Promise<SponsorStudent>}
 */
const getSponsorStudentById = async (id) => {
  return SponsorStudent.findById(id);
};

/**
 * Update role by id
 * @param {ObjectId} id
 * @param {Object} updateBody
 * @returns {Promise<SponsorStudent>}
 */
const updateSponsorStudentById = async (id, updateBody) => {
  const sponsorStudent = await getSponsorStudentById(id);
  if (!sponsorStudent) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Student not found');
  }
  Object.assign(sponsorStudent, updateBody);
  await sponsorStudent.save();
  return sponsorStudent;
};

/**
 * Delete role by id
 * @param {ObjectId} roleId
 * @returns {Promise<SponsorStudent>}
 */
const deleteSponsorStudentById = async (sponsorStudentId) => {
  const sponsorStudent = await getSponsorStudentById(sponsorStudentId);
  if (!sponsorStudent) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Student not found');
  }
  await sponsorStudent.remove();
  return sponsorStudent;
};

module.exports = {
  createSponsorStudent,
  querySponsorStudents,
  getSponsorStudentById,
  updateSponsorStudentById,
  deleteSponsorStudentById,
};
