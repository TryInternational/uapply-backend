const httpStatus = require('http-status');
const { CourseDetails } = require('../models');
const ApiError = require('../utils/ApiError');

/**
 * Create a booking
 * @param {Object} courseBody
 * @returns {Promise<Course>}
 */
const createCourseDetails = async (courseBody) => {
  const course = await CourseDetails.create(courseBody);
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
const queryCourseDetails = async (filter, options) => {
  const courses = await CourseDetails.paginate(filter, options);
  return courses;
};

const getCourseDetailsByRef = async (courseRefId) => {
  const courses = await CourseDetails.find({ courseRefId });
  return courses;
};

/**
 * @param {ObjectId} id
 * @returns {Promise<User>}
 */
const getCourseDetailsById = async (id) => {
  console.log(id);
  return CourseDetails.find({ id });
};
const getCourseDetails = async () => {
  return CourseDetails.find();
};

/**
 * Update booking by id
 * @param {ObjectId} id
 * @param {Object} updateBody
 * @returns {Promise<User>}
 */
const updateCourseDetailsById = async (id, updateBody) => {
  const course = await getCourseDetailsById(id);
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
const deleteCourseDetailsById = async (courseId) => {
  const course = await getCourseDetailsById(courseId);
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

const searchCourseDetails = async (text, options) => {
  // eslint-disable-next-line security/detect-non-literal-regexp
  const regex = new RegExp(text, 'i');
  const courses = await CourseDetails.paginate(
    { $and: [{ status: 'Paid', $or: [{ fullname: regex }, { phoneNumber: regex }, { email: regex }] }] },
    options
  );
  return courses;
};

module.exports = {
  createCourseDetails,
  queryCourseDetails,
  getCourseDetailsById,
  updateCourseDetailsById,
  deleteCourseDetailsById,
  getCourseDetails,
  searchCourseDetails,
  getCourseDetailsByRef,
};
