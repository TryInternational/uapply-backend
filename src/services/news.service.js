const httpStatus = require('http-status');
const { News } = require('../models');
const ApiError = require('../utils/ApiError');

/**
 * Create a role
 * @param {Object} roleBody
 * @returns {Promise<Roles>}
 */
const createNews = async (newsBody) => {
  const news = await News.create(newsBody);
  return news;
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
const queryNews = async () => {
  const news = await News.find();
  return news;
};

/**
 * Get role by id
 * @param {ObjectId} id
 * @returns {Promise<News>}
 */
const getNewsById = async (id) => {
  return News.findById(id);
};

/**
 * Update role by id
 * @param {ObjectId} id
 * @param {Object} updateBody
 * @returns {Promise<Roles>}
 */
const updateNewsById = async (id, updateBody) => {
  const news = await getNewsById(id);
  if (!news) {
    throw new ApiError(httpStatus.NOT_FOUND, 'News not found');
  }
  Object.assign(news, updateBody);
  await news.save();
  return news;
};

/**
 * Delete role by id
 * @param {ObjectId} roleId
 * @returns {Promise<Roles>}
 */
const deleteNewsById = async (roleId) => {
  const news = await getNewsById(roleId);
  if (!news) {
    throw new ApiError(httpStatus.NOT_FOUND, 'News not found');
  }
  await news.remove();
  return news;
};

module.exports = {
  createNews,
  queryNews,
  getNewsById,
  updateNewsById,
  deleteNewsById,
};
