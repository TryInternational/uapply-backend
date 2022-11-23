const httpStatus = require('http-status');
const { Subjects } = require('../models');
const ApiError = require('../utils/ApiError');

/**
 * Create a booking
 * @param {Object} subjectBody
 * @returns {Promise<Subject>}
 */
const createSubject = async (subjectBody) => {
  const subject = await Subjects.create(subjectBody);
  return subject;
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
const querySubjects = async (filter, options) => {
  const subject = await Subjects.paginate(filter, options);
  return subject;
};

/**
 * @param {ObjectId} id
 * @returns {Promise<User>}
 */
const getSubjectById = async (id) => {
  return Subjects.findById(id);
};
const getSubjects = async () => {
  return Subjects.find();
};

/**
 * Update booking by id
 * @param {ObjectId} id
 * @param {Object} updateBody
 * @returns {Promise<User>}
 */
const updateSubjectById = async (id, updateBody) => {
  const subject = await getSubjectById(id);
  if (!subject) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Subjects not found');
  }
  Object.assign(subject, updateBody);
  await subject.save();
  return subject;
};

/**
 * Delete booking by id
 * @param {ObjectId} subjectId
 * @returns {Promise<User>}
 */
const deleteSubjectById = async (subjectId) => {
  const subject = await getSubjectById(subjectId);
  if (!subject) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Subject not found');
  }
  await subject.remove();
  return subject;
};

/**
 * Delete booking by id
 * @param {ObjectId} subjectId
 * @param {Object} commentBody
 * @returns {Promise<Comment>}
 */

const searchSubjects = async (text, options) => {
  // eslint-disable-next-line security/detect-non-literal-regexp
  const regex = new RegExp(text, 'i');
  const subject = await Subjects.paginate({ name: regex }, options);
  return subject;
};

module.exports = {
  createSubject,
  querySubjects,
  getSubjectById,
  updateSubjectById,
  deleteSubjectById,
  getSubjects,
  searchSubjects,
};
