const httpStatus = require('http-status');
const { Roles } = require('../models');
const ApiError = require('../utils/ApiError');

/**
 * Create a role
 * @param {Object} roleBody
 * @returns {Promise<Roles>}
 */
const createRole = async (roleBody) => {
  const role = await Roles.create(roleBody);
  return role;
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
const queryRoles = async (filter, options) => {
  const roles = await Roles.paginate(filter, options);
  return roles;
};

/**
 * Get role by id
 * @param {ObjectId} id
 * @returns {Promise<Roles>}
 */
const getRoleById = async (id) => {
  return Roles.findById(id);
};

/**
 * Update role by id
 * @param {ObjectId} id
 * @param {Object} updateBody
 * @returns {Promise<Roles>}
 */
const updateRoleById = async (id, updateBody) => {
  const role = await getRoleById(id);
  if (!role) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Roles not found');
  }
  Object.assign(role, updateBody);
  await role.save();
  return role;
};

/**
 * Delete role by id
 * @param {ObjectId} roleId
 * @returns {Promise<Roles>}
 */
const deleteRoleById = async (roleId) => {
  const role = await getRoleById(roleId);
  if (!role) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Roles not found');
  }
  await role.remove();
  return role;
};

module.exports = {
  createRole,
  queryRoles,
  getRoleById,
  updateRoleById,
  deleteRoleById,
};
