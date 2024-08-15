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
        // Convert tag.dateSubmitted to a Date object if feeType is 'english-self-funded'
        month: {
          $cond: {
            if: { $eq: ['$feeType', 'english-self-funded'] },
            then: { $month: { $toDate: '$tag.dateSubmitted' } }, // Convert tag.dateSubmitted to Date and extract month
            else: { $month: '$createdDate' }, // Use createdDate for others
          },
        },
        year: {
          $cond: {
            if: { $eq: ['$feeType', 'english-self-funded'] },
            then: { $year: { $toDate: '$tag.dateSubmitted' } }, // Convert tag.dateSubmitted to Date and extract year
            else: { $year: '$createdDate' }, // Use createdDate for others
          },
        },
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
      ...(feeType === 'english-self-funded'
        ? {
            // Convert tag.dateSubmitted to Date and filter within the range
            $expr: {
              $and: [
                { $gte: [{ $toDate: '$tag.dateSubmitted' }, new Date(startDate)] },
                { $lte: [{ $toDate: '$tag.dateSubmitted' }, new Date(endDate)] },
              ],
            },
          }
        : {
            createdDate: { $gte: new Date(startDate), $lte: new Date(endDate) }, // Use createdDate for others
          }),
    },
  };

  const sortStage = { $sort: { totalAmount: -1 } };
  const limitStage = { $limit: 10 };

  const buildGroupStage = (groupByField) => ({
    $group: {
      _id: `$${groupByField}`,
      totalAmount: { $sum: '$tag.amount' },
      bookings: { $sum: 1 },
      ...(feeType === 'english-self-funded' && { totalNoOfWeeks: { $sum: '$tag.noOfWeeks' } }),
    },
  });

  const buildProjectStage = (groupByField) => ({
    $project: {
      [groupByField.replace(/\./g, '_')]: '$_id',
      totalAmount: 1,
      bookings: 1,
      ...(feeType === 'english-self-funded' && { totalNoOfWeeks: 1 }),
      _id: 0,
    },
  });

  let pipelines;

  if (feeType === 'student-visa') {
    const inchargePipeline = [
      matchStage,
      { $group: { _id: { incharge: '$tag.incharge' }, totalAmount: { $sum: '$tag.amount' }, bookings: { $sum: 1 } } },
      sortStage,
      limitStage,
      { $project: { incharge: '$_id.incharge', totalAmount: 1, bookings: 1, _id: 0 } },
    ];
    const checkedByPipeline = [
      matchStage,
      { $group: { _id: { checkedBy: '$tag.checkedBy' }, totalAmount: { $sum: '$tag.amount' }, bookings: { $sum: 1 } } },
      sortStage,
      limitStage,
      { $project: { checkedBy: '$_id.checkedBy', totalAmount: 1, bookings: 1, _id: 0 } },
    ];
    pipelines = [inchargePipeline, checkedByPipeline];
  } else if (feeType === 'english-self-funded') {
    const groupStage = {
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
    pipelines = [[matchStage, groupStage, sortStage, limitStage, projectStage]];
  } else if (feeType === 'office-fees') {
    const groupStage = buildGroupStage('tag.salesPerson');
    const projectStage = buildProjectStage('tag.salesPerson');
    pipelines = [[matchStage, groupStage, sortStage, limitStage, projectStage]];
  } else {
    const groupStage = buildGroupStage(groupByFields[0]);
    const projectStage = buildProjectStage(groupByFields[0]);
    pipelines = [[matchStage, groupStage, sortStage, limitStage, projectStage]];
  }

  const results = await Promise.all(pipelines.map((pipeline) => Fees.aggregate(pipeline)));

  // Flatten the results array if there are multiple pipelines
  return results.flat();
};

const getTopSchools = async ({ startDate, endDate }) => {
  const query = { 'tag.school': { $exists: true, $ne: null } };

  if (startDate && endDate) {
    query.createdDate = {
      $gte: new Date(startDate),
      $lte: new Date(endDate),
    };
  }

  const topSchools = await Fees.aggregate([
    { $match: query }, // Apply the query filter
    {
      $group: {
        _id: '$tag.school.name',
        totalAmount: { $sum: '$tag.amount' },
        totalWeeks: { $sum: '$tag.noOfWeeks' },
        totalStudents: { $sum: 1 },
        logo_url: { $first: '$tag.school.logo_url' },
      },
    },
    {
      $sort: { totalAmount: -1 },
    },
    {
      $project: {
        _id: 0,
        school: '$_id',
        totalAmount: 1,
        totalWeeks: 1,
        totalStudents: 1,
        logo_url: 1,
      },
    },
    {
      $limit: 3,
    },
  ]);

  return topSchools;
};

const getTopTypes = async ({ startDate, endDate }) => {
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

  const topTypes = await Fees.aggregate([
    {
      $match: { ...query, feeType: 'office-fees' },
    },
    { $match: { feeType: { $ne: '' } } }, // Add this line to filter out empty school IDs

    {
      $unwind: '$tag.type',
    },
    {
      $group: {
        _id: '$tag.type.value',
        count: { $sum: 1 },
      },
    },
    {
      $sort: {
        count: -1,
      },
    },
    // {
    //   $limit: 3,
    // },
  ]);

  return topTypes;
};

const getTopTests = async ({ startDate, endDate }) => {
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

  const topTests = await Fees.aggregate([
    {
      $match: { ...query, feeType: 'ielts-booking' },
    },
    { $match: { feeType: { $ne: '' } } }, // Add this line to filter out empty school IDs

    {
      $unwind: '$tag.typeOfTest',
    },
    {
      $group: {
        _id: '$tag.typeOfTest',
        count: { $sum: 1 },
      },
    },
    {
      $sort: {
        count: -1,
      },
    },
    // {
    //   $limit: 3,
    // },
  ]);

  return topTests;
};

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
    { $match: { 'tag.location': { $ne: '' } } }, // Add this line to filter out empty city IDs
    {
      $group: {
        _id: '$tag.location', // Adjust the field name as per your schema
        numberOfStudents: { $sum: 1 },
        totalWeeks: { $sum: '$tag.noOfWeeks' }, // Adjust the field name if it's different
      },
    },
    { $sort: { numberOfStudents: -1 } },
    // { $limit: 10 },
  ]);

  return topCities;
};

const getDashboardData = async (data) => {
  const amounts = await getAmounts();

  const topSchools = await getTopSchools({ startDate: data.startDate, endDate: data.endDate });
  const topTypes = await getTopTypes({ startDate: data.startDate, endDate: data.endDate });

  const topTests = await getTopTests({ startDate: data.startDate, endDate: data.endDate });
  const topCities = await getTopCities({ startDate: data.startDate, endDate: data.endDate });

  return {
    amounts,
    topSchools,
    topTypes,
    topTests,
    topCities,
  };
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
  getTopTypes,
  getTopTests,
  getDashboardData,
};
