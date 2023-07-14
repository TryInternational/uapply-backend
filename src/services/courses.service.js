const httpStatus = require('http-status');
const { Courses } = require('../models');
const ApiError = require('../utils/ApiError');

/**
 * Create a booking
 * @param {Object} courseBody
 * @returns {Promise<Course>}
 */
const createCourse = async (courseBody) => {
  const course = await Courses.create(courseBody);
  return course;
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
const queryCourses = async (filter, options) => {
  const courses = await Courses.paginate(filter, options);
  return courses;
};

/**
 * @param {ObjectId} id
 * @returns {Promise<User>}
 */
const getCourseById = async (id) => {
  return Courses.findById(id);
};
const getCourses = async () => {
  return Courses.find();
};

/**
 * Update booking by id
 * @param {ObjectId} id
 * @param {Object} updateBody
 * @returns {Promise<User>}
 */
const updateCourseById = async (id, updateBody) => {
  const course = await getCourseById(id);
  if (!course) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Courses not found');
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
const deleteCourseById = async (courseId) => {
  const course = await getCourseById(courseId);
  if (!course) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Course not found');
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

const searchCourse = async (text, options) => {
  // eslint-disable-next-line security/detect-non-literal-regexp
  const regex = new RegExp(text, 'i');
  const courses = await Courses.paginate({ name: regex }, options);
  return courses;
};

module.exports = {
  createCourse,
  queryCourses,
  getCourseById,
  updateCourseById,
  deleteCourseById,
  getCourses,
  searchCourse,
};
