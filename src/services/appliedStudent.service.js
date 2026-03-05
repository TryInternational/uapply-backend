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
const getUserNumberSums = async (startDate, endDate) => {
  if (!startDate || !endDate) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Start date and end date are required');
  }

  const sums = await AppliedStudent.aggregate([
    {
      $match: {
        createdDate: {
          $gte: new Date(startDate),
          $lte: new Date(endDate),
        },
      },
    },
    {
      $group: {
        _id: '$counsellor',
        totalNumber: { $sum: { $toInt: '$number' } }, // Convert number to integer and sum
      },
    },
    {
      $lookup: {
        from: 'users', // Assuming your users collection is named 'users'
        localField: '_id',
        foreignField: '_id',
        as: 'userInfo',
      },
    },
    {
      $unwind: {
        path: '$userInfo',
        preserveNullAndEmptyArrays: true, // Keep counsellors even if user not found
      },
    },
    {
      $project: {
        _id: 0,
        counsellor: '$_id',
        totalNumber: 1,
        role: { $ifNull: ['$userInfo.role', 'unknown'] }, // Get role from user info, default to 'unknown' if not found
      },
    },
  ]);

  return sums;
};

const getStudentCountByDegree = async (filters = {}) => {
  const matchStage = {};

  // Add date range filter if provided
  if (filters.startDate && filters.endDate) {
    matchStage.createdDate = {
      $gte: new Date(filters.startDate),
      $lte: new Date(filters.endDate),
    };
  }
  const degreeCounts = await AppliedStudent.aggregate([
    {
      $match: matchStage,
    },
    {
      $group: {
        _id: '$degree',
        count: { $sum: 1 },
        totalNumber: { $sum: '$number' }, // Sum of number field
      },
    },
    {
      $project: {
        _id: 0,
        degree: '$_id',
        count: 1,
        number: '$totalNumber', // Rename totalNumber to number
      },
    },
    {
      $sort: { degree: 1 },
    },
  ]);

  return degreeCounts;
};

module.exports = {
  createAppliedStudent,
  queryAppliedStudents,
  getAppliedStudentById,
  updateAppliedStudentById,
  deleteAppliedStudentById,
  getAmounts,
  getUserNumberSums,
  getStudentCountByDegree,
};
