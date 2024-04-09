const httpStatus = require('http-status');
const { AppliedStudent } = require('../models');
const ApiError = require('../utils/ApiError');

/**
 * Create a role
 * @param {Object} documentBody
 * @returns {Promise<Documents>}
 */
const createAppliedStudent = async (body) => {
  const fees = await AppliedStudent.create(body);
  return fees;
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

const queryAppliedStudents = async (filter, options) => {
  const fees = await AppliedStudent.paginate(filter, options);

  return fees;
};

/**
 * Get role by id
 * @param {ObjectId} id
 * @returns {Promise<Documents>}
 */
const getAppliedStudentById = async (id) => {
  return AppliedStudent.findById(id);
};

const getAmounts = async () => {
  const monthlySums = await AppliedStudent.aggregate([
    {
      $addFields: {
        month: { $month: '$createdDate' }, // Extract month from createdDate
        year: { $year: '$createdDate' }, // Extract year from createdDate
      },
    },
    {
      $group: {
        _id: { month: '$month', year: '$year' },
        number: { $sum: { $toInt: '$number' } }, // Convert amount to integer and sum
      },
    },
    {
      $project: {
        _id: 0,
        month: '$_id.month',
        year: '$_id.year',
        number: 1,
      },
    },
  ]);

  return monthlySums;
};

/**
 * Update role by id
 * @param {ObjectId} id
 * @param {Object} updateBody
 * @returns {Promise<Documents>}
 */
const updateAppliedStudentById = async (id, updateBody) => {
  const fees = await getAppliedStudentById(id);
  if (!fees) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Student not found');
  }
  Object.assign(fees, updateBody);
  await fees.save();
  return fees;
};

/**
 * Delete role by id
 * @param {ObjectId} roleId
 * @returns {Promise<Documents>}
 */
const deleteAppliedStudentById = async (id) => {
  const student = await getAppliedStudentById(id);
  if (!student) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Documents not found');
  }
  await student.remove();
  return student;
};

module.exports = {
  createAppliedStudent,
  queryAppliedStudents,
  getAppliedStudentById,
  updateAppliedStudentById,
  deleteAppliedStudentById,
  getAmounts,
};
