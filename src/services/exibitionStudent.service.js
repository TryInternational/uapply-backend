const httpStatus = require('http-status');
const { ExibitionStudent } = require('../models');
const ApiError = require('../utils/ApiError');

/**
 * Create a role
 * @param {Object} documentBody
 * @returns {Promise<Documents>}
 */
const createExibitionStudent = async (body) => {
  const student = await ExibitionStudent.create(body);
  return student;
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

// const queryExibitionStudent = async (filter, options) => {
//   const array1 = [];
//   const array2 = [];

//   const filteredArray1 = array1.filter((value) => !array2.includes(value));

//   return filteredArray1;
// };

const queryExibitionStudent = async (filter, options) => {
  const student = await ExibitionStudent.paginate(filter, options);

  return student;
};

/**
 * Get role by id
 * @param {ObjectId} id
 * @returns {Promise<Documents>}
 */
const getExibitionStudentById = async (id) => {
  return ExibitionStudent.findById(id);
};

/**
 * Update role by id
 * @param {ObjectId} id
 * @param {Object} updateBody
 * @returns {Promise<Documents>}
 */
const updateExibitionStudentsById = async (id, updateBody) => {
  const role = await getExibitionStudentById(id);
  if (!role) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Student not found');
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
const deleteExibitionStudentById = async (id) => {
  const student = await getExibitionStudentById(id);
  if (!student) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Documents not found');
  }
  await student.remove();
  return student;
};

module.exports = {
  createExibitionStudent,
  queryExibitionStudent,
  getExibitionStudentById,
  updateExibitionStudentsById,
  deleteExibitionStudentById,
};
