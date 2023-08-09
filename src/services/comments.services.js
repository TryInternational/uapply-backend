const httpStatus = require('http-status');
const { Comments } = require('../models');
const ApiError = require('../utils/ApiError');

/**
 * Create a booking
 * @param {Object} commentBody
 * @returns {Promise<Comment>}
 */
const createComments = async (commentBody) => {
  const comment = await Comments.create(commentBody);
  return comment;
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
const queryComments = async (filter, options) => {
  const comment = await Comments.paginate(filter, options);
  return comment;
};

/**
 * @param {ObjectId} id
 * @returns {Promise<User>}
 */
const getCommentById = async (id) => {
  return Comments.findById(id);
};

const getCommentByStudentId = async (studentId) => {
  return Comments.find({ studentId });
};

/**
 * Update booking by id
 * @param {ObjectId} id
 * @param {Object} updateBody
 * @returns {Promise<User>}
 */
const updateCommentById = async (id, updateBody) => {
  const comment = await getCommentById(id);
  if (!comment) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Comment not found');
  }
  Object.assign(comment, updateBody);
  await comment.save();
  return comment;
};

/**
 * Delete booking by id
 * @param {ObjectId} commentId
 * @returns {Promise<User>}
 */
const deleteCommentById = async (commentId) => {
  const comment = await getCommentById(commentId);
  if (!comment) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Comment not found');
  }
  await comment.remove();
  return comment;
};

/**
 * Delete booking by id
 * @param {ObjectId} commentId
 * @param {Object} commentBody
 * @returns {Promise<Comment>}
 */

// const searchComment = async (text, options) => {
//   // eslint-disable-next-line security/detect-non-literal-regexp
//   const regex = new RegExp(text, 'i');
//   const comment = await Comments.paginate({ $or: [{ english_name: regex }, { arabic_name: regex }] }, options);
//   return comment;
// };

module.exports = {
  createComments,
  queryComments,
  getCommentById,
  updateCommentById,
  deleteCommentById,
  //   searchComment,
  getCommentByStudentId,
};
