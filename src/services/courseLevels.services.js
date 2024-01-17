const httpStatus = require('http-status');
const { CourseLevels } = require('../models');
const ApiError = require('../utils/ApiError');

/**
 * Create a booking
 * @param {Object} courseLevelBody
 * @returns {Promise<CourseLevel>}
 */
const createCourseLevel = async (courseLevelBody) => {
  const courseLevel = await CourseLevels.create(courseLevelBody);
  return courseLevel;
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
const queryCourseLevels = async (filter, options) => {
  const courseLevels = await CourseLevels.paginate(filter, options);
  return courseLevels;
};

/**
 * @param {ObjectId} id
 * @returns {Promise<CourseLevels>}
 */
const getCourseLevelById = async (id) => {
  return CourseLevels.findById(id);
};
const getCourseLevels = async () => {
  return CourseLevels.find();
};

/**
 * Update booking by id
 * @param {ObjectId} id
 * @param {Object} updateBody
 * @returns {Promise<User>}
 */
const updateCourseLevelById = async (id, updateBody) => {
  const courseLevel = await getCourseLevelById(id);
  if (!courseLevel) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Course Level not found');
  }
  Object.assign(courseLevel, updateBody);
  await courseLevel.save();
  return courseLevel;
};

/**
 * Delete booking by id
 * @param {ObjectId} courseLevelId
 * @returns {Promise<User>}
 */
const deleteCourseLevelById = async (courseLevelId) => {
  const courseLevel = await getCourseLevelById(courseLevelId);
  if (!courseLevel) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Course Level not found');
  }
  await courseLevel.remove();
  return courseLevel;
};

/**
 * Delete booking by id
 * @param {ObjectId} courseLevelId
 * @param {Object} commentBody
 * @returns {Promise<Comment>}
 */

const searchCourseLevel = async (text, options) => {
  // eslint-disable-next-line security/detect-non-literal-regexp
  const regex = new RegExp(text, 'i');
  const courseLevels = await CourseLevels.paginate([{ en_name: regex }, { ar_name: regex }], options);
  return courseLevels;
};

module.exports = {
  createCourseLevel,
  queryCourseLevels,
  getCourseLevelById,
  updateCourseLevelById,
  deleteCourseLevelById,
  getCourseLevels,
  searchCourseLevel,
};
