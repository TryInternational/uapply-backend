const httpStatus = require('http-status');
const { Discipline } = require('../models');
const ApiError = require('../utils/ApiError');

/**
 * Create a role
 * @param {Object} roleBody
 * @returns {Promise<Discipline>}
 */
const createDiscipline = async (roleBody) => {
  const discipline = await Discipline.create(roleBody);
  return discipline;
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
const queryDisciplines = async (filter, options) => {
  const discipline = await Discipline.paginate(filter, options);
  return discipline;
};

/**
 * Get role by id
 * @param {ObjectId} id
 * @returns {Promise<Discipline>}
 */
const getDisciplineById = async (id) => {
  return Discipline.findById(id);
};

/**
 * Update role by id
 * @param {ObjectId} id
 * @param {Object} updateBody
 * @returns {Promise<Discipline>}
 */
const updateDisciplineById = async (id, updateBody) => {
  const discipline = await getDisciplineById(id);
  if (!discipline) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Discipline not found');
  }
  Object.assign(discipline, updateBody);
  await discipline.save();
  return discipline;
};

/**
 * Delete role by id
 * @param {ObjectId} roleId
 * @returns {Promise<Discipline>}
 */
const deleteDisciplineById = async (roleId) => {
  const discipline = await getDisciplineById(roleId);
  if (!discipline) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Discipline not found');
  }
  await discipline.remove();
  return discipline;
};

module.exports = {
  createDiscipline,
  queryDisciplines,
  getDisciplineById,
  updateDisciplineById,
  deleteDisciplineById,
};
