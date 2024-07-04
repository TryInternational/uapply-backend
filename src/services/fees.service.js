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
        bookingCount: { $sum: 1 }, // Count the number of documents (bookings)
      },
    },
    {
      $project: {
        _id: 0,
        feeType: '$_id.feeType',
        month: '$_id.month',
        year: '$_id.year',
        totalAmount: 1,
        bookingCount: 1,
      },
    },
  ]);

  // Generate an array of all possible months (1 to 12)
  const allMonths = Array.from({ length: 12 }, (_, i) => i + 1);

  // Create a map to store existing sums and counts for quick lookup
  const sumMap = new Map();
  monthlySums.forEach((item) => {
    const key = `${item.feeType}-${item.year}-${item.month}`;
    sumMap.set(key, { totalAmount: item.totalAmount, bookingCount: item.bookingCount });
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
        const { totalAmount = 0, bookingCount = 0 } = sumMap.get(key) || {};
        result.push({ feeType, year, month, totalAmount, bookingCount });
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
const getSales = async (feeType, groupByFields, startDate, endDate) => {
  const matchStage = {
    $match: {
      feeType,
      ...(feeType === 'office-fees' && { 'tag.salesPerson': { $ne: null, $ne: '' } }),
      createdDate: { $gte: new Date(startDate), $lte: new Date(endDate) }, // Add date range filter
    },
  };

  let groupStage;
  if (feeType === 'english-self-funded') {
    groupStage = {
      $group: {
        _id: {
          accountManager: '$tag.accountManager',
          operation: '$tag.operation',
          salesPerson: '$tag.salesPerson',
        },
        totalAmount: { $sum: '$tag.amount' },
        bookings: { $sum: 1 },
        totalNoOfWeeks: { $sum: '$tag.noOfWeeks' },
      },
    };
  } else {
    groupStage = {
      $group: {
        _id: `$${groupByFields[0]}`,
        totalAmount: { $sum: '$tag.amount' },
        bookings: { $sum: 1 },
      },
    };
  }

  const sortStage = { $sort: { totalAmount: -1 } };
  const limitStage = { $limit: 10 };
  const projectStage = {
    $project: {
      accountManager: '$_id.accountManager',
      operation: '$_id.operation',
      salesPerson: '$_id.salesPerson',
      totalAmount: 1,
      bookings: 1,
      totalNoOfWeeks: 1,
      _id: 0,
    },
  };

  if (feeType !== 'english-self-funded') {
    projectStage.$project = {
      [groupByFields[0]]: '$_id',
      totalAmount: 1,
      bookings: 1,
      _id: 0,
    };
  }

  return Fees.aggregate([matchStage, groupStage, sortStage, limitStage, projectStage]);
};

const getTopSchools = async ({ startDate, endDate }) => {
  let query = {};

  if (startDate && endDate) {
    query = {
      ...query,
      createdDate: {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      },
    };
  }

  const topSchools = await Fees.aggregate([
    { $match: { ...query, 'tag.school': { $exists: true, $ne: null } } },
    {
      $group: {
        _id: '$tag.school', // Adjust the field name as per your schema
        numberOfStudents: { $sum: 1 },
        totalWeeks: { $sum: '$tag.noOfWeeks' }, // Adjust the field name if it's different
      },
    },
    { $sort: { totalAmount: -1 } },
    { $limit: 10 },
  ]);

  return topSchools;
};

// Controller function to get top cities
const getTopCities = async ({ startDate, endDate }) => {
  let query = {};

  if (startDate && endDate) {
    query = {
      ...query,
      createdDate: {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      },
    };
  }

  const topCities = await Fees.aggregate([
    { $match: { ...query, 'tag.location': { $exists: true, $ne: null } } },
    {
      $group: {
        _id: '$tag.location', // Adjust the field name as per your schema
        numberOfStudents: { $sum: 1 },
        totalWeeks: { $sum: '$tag.noOfWeeks' }, // Adjust the field name if it's different
      },
    },
    { $sort: { numberOfStudents: -1 } },
    { $limit: 10 },
  ]);

  return topCities;
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
  getTopSchools,
  getTopCities,
};
