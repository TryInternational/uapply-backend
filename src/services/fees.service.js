/* eslint-disable no-nested-ternary */
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

/* Fee amounts are numbers, but older records hold strings ("150", "37.5"):
   $toInt threw on a decimal string (one bad record failed the whole card) and
   dropped the fils; a raw $sum skipped strings. */
const AMOUNT = { $convert: { input: '$tag.amount', to: 'double', onError: 0, onNull: 0 } };
const asDate = (field) => ({ $convert: { input: field, to: 'date', onError: null, onNull: null } });
const KUWAIT_TZ = 'Asia/Kuwait';
/** The Kuwait calendar day of an instant, as the "YYYY-MM-DD" the fee forms store. */
const kuwaitDay = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: KUWAIT_TZ });
/** [start of the Kuwait day of `s`, start of the day after the Kuwait day of `e`) for date-only fields. */
const dayBounds = (s, e) => {
  const from = new Date(kuwaitDay(s));
  const to = new Date(kuwaitDay(e));
  to.setUTCDate(to.getUTCDate() + 1);
  return [from, to];
};

const getAmounts = async () => {
  // Months are Kuwait months: an office fee entered at 00:30 on the 1st (21:30 UTC
  // the day before) belongs to the new month, not the previous one.
  const dated = {
    $cond: {
      if: { $in: ['$feeType', ['english-self-funded', 'ielts-booking', 'student-visa']] },
      then: asDate('$tag.dateSubmitted'),
      else: '$createdDate',
    },
  };
  const monthlySums = await Fees.aggregate([
    { $addFields: { _d: dated } },
    { $match: { _d: { $ne: null } } },
    {
      $addFields: {
        month: { $month: { date: '$_d', timezone: KUWAIT_TZ } },
        year: { $year: { date: '$_d', timezone: KUWAIT_TZ } },
      },
    },
    {
      $group: {
        _id: { feeType: '$feeType', month: '$month', year: '$year' },
        totalAmount: { $sum: AMOUNT },
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
// typed text is matched literally — "+965…" or "(" used to throw and fail the search
const literal = (v) => String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const searchFees = async (text, options) => {
  // eslint-disable-next-line security/detect-non-literal-regexp
  const regex = new RegExp(literal(text), 'i');

  const searchConditions = [
    { 'tag.fullName': regex },
    { 'tag.phoneNo': regex },
    { 'tag.typeOfTest': regex },
    { 'tag.passportNo': regex },
    { 'tag.vfsRefNo': regex },
    { 'tag.email': regex },
    { 'tag.vfsEmail': regex },
    { 'tag.location': regex },
    { 'tag.school': regex },
    { 'tag.type.label': regex },
  ];

  const fees = await Fees.paginate(
    {
      $and: [
        {
          feeType: options.feeType,
          $or: searchConditions,
        },
      ],
    },
    options
  );
  return fees;
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
  // Visa / English (dateSubmitted) and IELTS (dateOfTest) are date-only fields
  // ("YYYY-MM-DD"), so they are matched by Kuwait calendar day: every day the
  // range touches, whole. Comparing them with the range's instants dropped the
  // first day of the default range (30 days ago at the current time), and the
  // IELTS window, cut to UTC dates, began a day early.
  const [fromDay, toDay] = dayBounds(startDate, endDate);
  const dayMatch = (field) => ({
    $expr: { $and: [{ $gte: [asDate(field), fromDay] }, { $lt: [asDate(field), toDay] }] },
  });
  const matchStage = {
    $match: {
      feeType,
      // (was `{ $ne: null, $ne: '' }` — a duplicate key keeps only the second)
      ...(feeType === 'office-fees' && { 'tag.salesPerson': { $nin: [null, ''] } }),
      ...(feeType === 'english-self-funded' || feeType === 'student-visa'
        ? dayMatch('$tag.dateSubmitted')
        : feeType === 'ielts-booking'
        ? dayMatch('$tag.dateOfTest')
        : {
            createdDate: { $gte: new Date(startDate), $lte: new Date(endDate) },
          }),
    },
  };

  const sortStage = { $sort: { totalAmount: -1 } };
  // Every person, not the top 10: the cards show the top rows but total them
  // all, and the English card merges (AM, ops, sales) triples by salesperson
  // AFTER this — cutting first lost a person's other triples.
  const limitStage = { $limit: 500 };

  const buildGroupStage = (groupByField) => ({
    $group: {
      _id: `$${groupByField}`,
      totalAmount: { $sum: AMOUNT },
      bookings: { $sum: 1 },
      ...(feeType === 'english-self-funded' && { totalNoOfWeeks: { $sum: '$tag.noOfWeeks' } }),
    },
  });

  const buildProjectStage = (groupByField, fieldName) => ({
    $project: {
      [fieldName]: '$_id',
      totalAmount: 1,
      bookings: 1,
      ...(feeType === 'english-self-funded' && { totalNoOfWeeks: 1 }),
      _id: 0,
    },
  });

  let pipelines;

  if (feeType === 'student-visa') {
    // Incharge pipeline
    const inchargePipeline = [
      matchStage,
      {
        $group: {
          _id: '$tag.incharge',
          totalAmount: { $sum: AMOUNT },
          bookings: { $sum: 1 },
        },
      },
      sortStage,
      limitStage,
      {
        $project: {
          incharge: '$_id',
          totalAmount: 1,
          bookings: 1,
          _id: 0,
        },
      },
    ];

    // CheckedBy pipeline
    const checkedByPipeline = [
      matchStage,
      {
        $group: {
          _id: '$tag.checkedBy',
          totalAmount: { $sum: AMOUNT },
          bookings: { $sum: 1 },
        },
      },
      sortStage,
      limitStage,
      {
        $project: {
          checkedBy: '$_id',
          totalAmount: 1,
          bookings: 1,
          _id: 0,
        },
      },
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
        totalAmount: { $sum: AMOUNT },
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
    const projectStage = buildProjectStage('tag.salesPerson', 'salesPerson');
    pipelines = [[matchStage, groupStage, sortStage, limitStage, projectStage]];
  } else if (feeType === 'ielts-booking') {
    const inchargePipeline = [
      matchStage,
      { $group: { _id: '$tag.incharge', bookings: { $sum: 1 } } },
      sortStage,
      limitStage,
      { $project: { incharge: '$_id', bookings: 1, _id: 0 } },
    ];
    pipelines = [inchargePipeline];
  } else {
    const groupStage = buildGroupStage(groupByFields[0]);
    const projectStage = buildProjectStage(groupByFields[0], groupByFields[0].split('.').pop());
    pipelines = [[matchStage, groupStage, sortStage, limitStage, projectStage]];
  }

  const results = await Promise.all(pipelines.map((pipeline) => Fees.aggregate(pipeline)));

  // For student-visa, combine both arrays into one
  if (feeType === 'student-visa') {
    return [...results[0], ...results[1]];
  }

  // For other fee types, return the flattened array
  return results.flat();
};

const getTopSchools = async ({ startDate, endDate }) => {
  const query = { 'tag.school': { $exists: true, $ne: null } };

  if (startDate && endDate) {
    query['tag.dateSubmitted'] = {
      $gte: new Date(startDate),
      $lte: new Date(endDate),
    };
  }

  const topSchools = await Fees.aggregate([
    // Convert dateSubmitted from string to Date
    {
      $addFields: {
        'tag.dateSubmitted': { $toDate: '$tag.dateSubmitted' },
      },
    },
    { $match: query }, // Apply the query filter
    {
      $group: {
        _id: '$tag.school.name',
        totalAmount: { $sum: AMOUNT },
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
    // {
    //   $limit: 3,
    // },
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
  const query = { feeType: 'ielts-booking' };
  const date = new Date(startDate);
  const eDate = new Date(endDate);

  const formatted = date.toISOString().split('T')[0];
  const formattedEnd = eDate.toISOString().split('T')[0];

  if (startDate && endDate) {
    query['tag.dateOfTest'] = {
      $gte: new Date(formatted),
      $lte: new Date(formattedEnd),
    };
  }

  const topTests = await Fees.aggregate([
    // Convert dateSubmitted from string to Date
    {
      $addFields: {
        'tag.dateOfTest': { $toDate: '$tag.dateOfTest' },
      },
    },
    { $match: query }, // Apply the query filter
    // { $match: { feeType: { $ne: '' } } }, // Filter out empty school IDs
    { $unwind: '$tag.typeOfTest' }, // Unwind the typeOfTest array
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
      'tag.dateSubmitted': {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      },
    };
  }

  const topCities = await Fees.aggregate([
    // Convert dateSubmitted from string to Date
    {
      $addFields: {
        'tag.dateSubmitted': { $toDate: '$tag.dateSubmitted' },
      },
    },
    { $match: { ...query, 'tag.location': { $exists: true, $ne: null } } },
    { $match: { 'tag.location': { $ne: '' } } }, // Filter out empty city IDs
    {
      $group: {
        _id: '$tag.location', // Group by location
        numberOfStudents: { $sum: 1 }, // Count number of students
        totalWeeks: { $sum: '$tag.noOfWeeks' }, // Sum the number of weeks
      },
    },
    { $sort: { numberOfStudents: -1 } }, // Sort by the number of students
    // { $limit: 10 }, // Uncomment if you want to limit the results to top 10
  ]);

  return topCities;
};

const getEnglishSelfFundedData = async ({ startDate, endDate }) => {
  const result = await Fees.aggregate([
    {
      $match: {
        feeType: 'english-self-funded',
        $expr: {
          $and: [
            { $gte: [{ $toDate: '$tag.dateSubmitted' }, new Date(startDate)] },
            { $lte: [{ $toDate: '$tag.dateSubmitted' }, new Date(endDate)] },
          ],
        },
      },
    },
    {
      $group: {
        _id: null, // Group all data into one bucket
        totalBookings: { $sum: 1 }, // Count of documents
        totalWeeks: { $sum: { $toInt: '$tag.noOfWeeks' } }, // Sum of weeks
        totalAmount: { $sum: { $toDouble: '$tag.amount' } }, // Sum of amount
      },
    },
    {
      $project: {
        _id: 0,
        totalBookings: 1,
        totalWeeks: 1,
        totalAmount: 1,
      },
    },
  ]);

  // If no results, return defaults
  return result.length > 0 ? result[0] : { totalBookings: 0, totalWeeks: 0, totalAmount: 0 };
};

const getDashboardData = async (data) => {
  const range = { startDate: data.startDate, endDate: data.endDate };
  // independent aggregates — run together instead of one after another
  const [amounts, topSchools, topTypes, selfFunded, topTests, topCities] = await Promise.all([
    getAmounts(),
    getTopSchools(range),
    getTopTypes(range),
    getEnglishSelfFundedData(range),
    getTopTests(range),
    getTopCities(range),
  ]);

  return {
    amounts,
    topSchools,
    topTypes,
    topTests,
    topCities,
    selfFunded,
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
  getEnglishSelfFundedData,
};
