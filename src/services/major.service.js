const httpStatus = require('http-status');
const { DateTime } = require('luxon');
const { Major } = require('../models');
const ApiError = require('../utils/ApiError');
const { convertASTToUTC } = require('../utils/Common');

/**
 * Create a major
 * @param {Object} majorBody
 * @returns {Promise<Major>}
 */
const createMajor = async (majorBody) => {
  const result = await Major.create(majorBody);
  return result;
};

/**
 * Get major by id
 * @param {ObjectId} id
 * @returns {Promise<Major>}
 */
const getMajorById = async (id) => {
  return Major.findById(id);
};

/**
 * Query for majors
 * @param {Object} filter - Mongo filter
 * @param {Object} options - Query options
 * @param {string} [options.sortBy] - Sort option in the format: sortField:(desc|asc)
 * @param {number} [options.limit] - Maximum number of results per page (default = 10)
 * @param {number} [options.page] - Current page (default = 1)
 * @returns {Promise<QueryResult>}
 */
const getMajors = async (filter, options) => {
  const results = await Major.paginate(filter, options);
  return results;
};

/**
 * Update major by id
 * @param {ObjectId} id
 * @param {Object} updateBody
 * @returns {Promise<Major>}
 */
const updateMajorById = async (id, updateBody) => {
  const major = await getMajorById(id);
  if (!major) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Major not found');
  }
  Object.assign(major, updateBody);
  await major.save();
  return major;
};

/**
 * Delete major by id
 * @param {ObjectId} majorId
 * @returns {Promise<Major>}
 */
const deleteMajorById = async (majorId) => {
  const major = await getMajorById(majorId);
  if (!major) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Major not found');
  }
  await major.remove();
  return major;
};

/**
 * Search majors by text
 * @param {string} text
 * @param {Object} options
 * @returns {Promise<QueryResult>}
 */
const searchMajors = async (text, options) => {
  // eslint-disable-next-line security/detect-non-literal-regexp
  const regex = new RegExp(text, 'i');
  const majors = await Major.paginate(
    {
      qualified: options.qualified,
      $or: [{ name: regex }, { phoneNo: regex }, { email: regex }, { countryCode: regex }, { fullname: regex }],
    },
    options
  );
  return majors;
};

/**
 * Get top 5 majors by countries
 * @param {Object} data
 * @returns {Promise<Array>}
 */
const getTop5ByCountries = async (data) => {
  const matchQuery = {
    qualified: data.qualified !== undefined ? data.qualified : true,
  };

  if (data.status) {
    matchQuery.status = data.status;
  }

  const startDate = DateTime.fromISO(new Date(data.startDate).toISOString(), {
    zone: 'Asia/Riyadh',
  }).startOf('day');
  const endDate = DateTime.fromISO(new Date(data.endDate).toISOString(), {
    zone: 'Asia/Riyadh',
  }).endOf('day');

  const sd = convertASTToUTC(startDate, true).toString();
  const ed = convertASTToUTC(endDate, true).toString();

  if (data.startDate && data.endDate) {
    matchQuery.createdAt = {
      $gte: sd,
      $lte: ed,
    };
  }

  const aggregationPipeline = [
    {
      $match: matchQuery,
    },
    {
      $group: {
        _id: '$nationality.english_name',
        count: { $sum: 1 },
      },
    },
    {
      $sort: { count: -1 },
    },
    {
      $limit: 5,
    },
  ];

  const result = await Major.aggregate(aggregationPipeline);
  return result;
};

/**
 * Get top 5 majors by degree
 * @param {Object} data
 * @returns {Promise<Array>}
 */
const getTop5ByDegree = async (data) => {
  const matchQuery = {
    qualified: data.qualified !== undefined ? data.qualified : true,
  };

  const startDate = DateTime.fromISO(new Date(data.startDate).toISOString(), {
    zone: 'Asia/Riyadh',
  }).startOf('day');
  const endDate = DateTime.fromISO(new Date(data.endDate).toISOString(), {
    zone: 'Asia/Riyadh',
  }).endOf('day');

  const sd = convertASTToUTC(startDate, true).toString();
  const ed = convertASTToUTC(endDate, true).toString();

  if (data.startDate && data.endDate) {
    matchQuery.createdAt = {
      $gte: sd,
      $lte: ed,
    };
  }

  const aggregationPipeline = [
    {
      $match: matchQuery,
    },
    {
      $group: {
        _id: '$degree.en_name',
        count: { $sum: 1 },
      },
    },
    {
      $sort: { count: -1 },
    },
    {
      $limit: 10,
    },
  ];

  const result = await Major.aggregate(aggregationPipeline);
  return result;
};

/**
 * Count majors based on filter
 * @param {Object} filter
 * @returns {Promise<Number>}
 */
const countMajors = async (filter) => {
  return Major.countDocuments(filter);
};

/**
 * Query majors with advanced filtering (similar to queryLeads)
 * @param {Object} filter
 * @param {Object} options
 * @returns {Promise<QueryResult>}
 */
const queryMajors = async (filter, options) => {
  const majors = await Major.paginate(filter, options);
  return majors;
};

/**
 * Get major by email
 * @param {string} email
 * @returns {Promise<Major>}
 */
const getMajorByEmail = async (email) => {
  return Major.findOne({ email });
};

/**
 * Check if email is taken
 * @param {string} email
 * @param {ObjectId} [excludeMajorId]
 * @returns {Promise<boolean>}
 */
const isEmailTaken = async (email, excludeMajorId) => {
  const major = await Major.findOne({ email, _id: { $ne: excludeMajorId } });
  return !!major;
};

module.exports = {
  createMajor,
  getMajorById,
  deleteMajorById,
  searchMajors,
  getMajors,
  updateMajorById,
  getTop5ByCountries,
  getTop5ByDegree,
  countMajors,
  queryMajors,
  getMajorByEmail,
  isEmailTaken,
};
