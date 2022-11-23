const httpStatus = require('http-status');
const { Universities } = require('../models');
const ApiError = require('../utils/ApiError');

/**
 * Create a booking
 * @param {Object} universityBody
 * @returns {Promise<Course>}
 */
const createUniversity = async (universityBody) => {
  const university = await Universities.create(universityBody);
  return university;
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
const queryUniversities = async (filter, options) => {
  const courses = await Universities.paginate(filter, options);
  return courses;
};

/**
 * @param {ObjectId} id
 * @returns {Promise<User>}
 */
const getUniversityById = async (id) => {
  return Universities.findById(id);
};
const getUniversities = async () => {
  return Universities.find();
};

/**
 * Update booking by id
 * @param {ObjectId} id
 * @param {Object} updateBody
 * @returns {Promise<User>}
 */
const updateUniversityById = async (id, updateBody) => {
  const course = await getUniversityById(id);
  if (!course) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Universities not found');
  }
  Object.assign(course, updateBody);
  await course.save();
  return course;
};

/**
 * Delete booking by id
 * @param {ObjectId} courseId
 * @returns {Promise<User>}
 */
const deleteUniversityById = async (courseId) => {
  const course = await getUniversityById(courseId);
  if (!course) {
    throw new ApiError(httpStatus.NOT_FOUND, 'University not found');
  }
  await course.remove();
  return course;
};

/**
 * Delete booking by id
 * @param {ObjectId} courseId
 * @param {Object} commentBody
 * @returns {Promise<Comment>}
 */

const searchUniversity = async (text, options) => {
  // eslint-disable-next-line security/detect-non-literal-regexp
  const regex = new RegExp(text, 'i');
  const courses = await Universities.find({ name: regex }, options);
  return courses;
};

module.exports = {
  createUniversity,
  queryUniversities,
  getUniversityById,
  updateUniversityById,
  deleteUniversityById,
  getUniversities,
  searchUniversity,
};
