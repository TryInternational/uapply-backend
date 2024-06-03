/* eslint-disable no-restricted-syntax */
const httpStatus = require('http-status');
const { Fees } = require('../models');
const ApiError = require('../utils/ApiError');

/**
 * Create a role
 * @param {Object} documentBody
 * @returns {Promise<Documents>}
 */
const createFees = async (body) => {
  const fees = await Fees.create(body);
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

const queryFees = async (filter, options) => {
  const fees = await Fees.paginate(filter, options);

  return fees;
};

/**
 * Get role by id
 * @param {ObjectId} id
 * @returns {Promise<Documents>}
 */
const getFeesById = async (id) => {
  return Fees.findById(id);
};

const getAmounts = async () => {
  const monthlySums = await Fees.aggregate([
    {
      $addFields: {
        month: { $month: '$createdDate' }, // Extract month from createdDate
        year: { $year: '$createdDate' }, // Extract year from createdDate
      },
    },
    {
      $group: {
        _id: { feeType: '$feeType', month: '$month', year: '$year' },
        totalAmount: { $sum: { $toInt: '$tag.amount' } }, // Convert amount to integer and sum
      },
    },
    {
      $project: {
        _id: 0,
        feeType: '$_id.feeType',
        month: '$_id.month',
        year: '$_id.year',
        totalAmount: 1,
      },
    },
  ]);

  // Generate an array of all possible months (1 to 12)
  const allMonths = Array.from({ length: 12 }, (_, i) => i + 1);

  // Create a map to store existing sums for quick lookup
  const sumMap = new Map();
  monthlySums.forEach((item) => {
    const key = `${item.feeType}-${item.year}-${item.month}`;
    sumMap.set(key, item.totalAmount);
  });

  // Create an array to hold the final result
  const result = [];

  // Extract unique feeType and year values, filtering out any null or undefined years
  const uniqueFeeTypes = [...new Set(monthlySums.map((item) => item.feeType))];
  const uniqueYears = [...new Set(monthlySums.map((item) => item.year).filter((year) => year != null))];

  uniqueFeeTypes.forEach((feeType) => {
    uniqueYears.forEach((year) => {
      allMonths.forEach((month) => {
        const key = `${feeType}-${year}-${month}`;
        const totalAmount = sumMap.get(key) || 0; // If sum exists, use it; otherwise, default to 0
        result.push({ feeType, year, month, totalAmount });
      });
    });
  });

  return result;
};

/**
 * Update role by id
 * @param {ObjectId} id
 * @param {Object} updateBody
 * @returns {Promise<Documents>}
 */
const updateFeesById = async (id, updateBody) => {
  const fees = await getFeesById(id);
  if (!fees) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Student not found');
  }
  Object.assign(fees, updateBody);
  await fees.save();
  return fees;
};

const searchFees = async (text, options) => {
  // eslint-disable-next-line security/detect-non-literal-regexp
  const regex = new RegExp(text, 'i');
  const courses = await Fees.paginate({ 'tag.fullName': regex }, options);
  return courses;
};
/**
 * Delete role by id
 * @param {ObjectId} roleId
 * @returns {Promise<Documents>}
 */
const deleteFeesById = async (id) => {
  const student = await getFeesById(id);
  if (!student) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Documents not found');
  }
  await student.remove();
  return student;
};
const getSales = async (feeType, groupByField) => {
  const matchStage = {
    $match: {
      feeType,
      ...(feeType === 'office-fees' && { 'tag.salesPerson': { $ne: null, $ne: '' } }),
    },
  };

  const groupStage = {
    $group: {
      _id: `$${groupByField}`,
      totalAmount: { $sum: '$tag.amount' },
      bookings: { $sum: 1 },
    },
  };

  const sortStage = { $sort: { totalAmount: -1 } };
  const limitStage = { $limit: 10 };
  const projectStage = {
    $project: {
      'tag.salesPerson': '$_id',
      totalAmount: 1,
      bookings: 1,
      _id: 0,
    },
  };

  return Fees.aggregate([matchStage, groupStage, sortStage, limitStage, projectStage]);
};
module.exports = {
  createFees,
  queryFees,
  getFeesById,
  updateFeesById,
  deleteFeesById,
  getAmounts,
  searchFees,
  getSales,
};
