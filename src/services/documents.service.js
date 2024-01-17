const httpStatus = require('http-status');
const { Documents } = require('../models');
const ApiError = require('../utils/ApiError');

/**
 * Create a role
 * @param {Object} documentBody
 * @returns {Promise<Documents>}
 */
const createDocumetns = async (documentBody) => {
  const document = await Documents.create(documentBody);
  return document;
};

/**
 * Query for Documents
 * @param {Object} filter - Mongo filter
 * @param {Object} options - Query options
 * @param {string} [options.sortBy] - Sort option in the format: sortField:(desc|asc)
 * @param {number} [options.limit] - Maximum number of results per page (default = 10)
 * @param {number} [options.page] - Current page (default = 1)
 * @returns {Promise<QueryResult>}
 */
const queryDocumetns = async (filter, options) => {
  const document = await Documents.paginate(filter, options);
  return document;
};

/**
 * Get role by id
 * @param {ObjectId} id
 * @returns {Promise<Documents>}
 */
const getDocumetnsById = async (id) => {
  return Documents.findById(id);
};

const getDocumetnByStudentId = async (studentId) => {
  return Documents.find({ studentId });
};

/**
 * Update role by id
 * @param {ObjectId} id
 * @param {Object} updateBody
 * @returns {Promise<Documents>}
 */
const updateDocumetnsById = async (id, updateBody) => {
  const role = await getDocumetnsById(id);
  if (!role) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Documents not found');
  }
  Object.assign(role, updateBody);
  await role.save();
  return role;
};

/**
 * Delete role by id
 * @param {ObjectId} roleId
 * @returns {Promise<Documents>}
 */
const deleteDocumetnById = async (documentsId) => {
  const document = await getDocumetnsById(documentsId);
  if (!document) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Documents not found');
  }
  await document.remove();
  return document;
};

module.exports = {
  createDocumetns,
  queryDocumetns,
  getDocumetnsById,
  updateDocumetnsById,
  deleteDocumetnById,
  getDocumetnByStudentId,
};
