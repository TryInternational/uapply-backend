const httpStatus = require('http-status');
const { UniversityDetails } = require('../models');
const ApiError = require('../utils/ApiError');

/**
 * Create a booking
 * @param {Object} universityBody
 * @returns {Promise<Course>}
 */
const createUniversitiesDetails = async (universityBody) => {
  const university = await UniversityDetails.create(universityBody);
  return university;
};

/**
 * Query for bookings
 * @param {Object} _filter - Mongo filter
 * @param {Object} options - Query options
 * @param {string} [options.sortBy] - Sort option in the format: sortField:(desc|asc)
 * @param {number} [options.limit] - Maximum number of results per page (default = 10)
 * @param {number} [options.page] - Current page (default = 1)
 * @returns {Promise<QueryResult>}
 */
const queryUniversitiesDetails = async (filter, options) => {
  const university = await UniversityDetails.paginate(filter, options);
  return university;
};
const getUniversitiesDetailsByRef = async (universityRefId) => {
  const uni = await UniversityDetails.find({ slug: universityRefId });
  return uni;
};
/**
 * @param {ObjectId} id
 * @returns {Promise<User>}
 */
const getUniversitiesDetailsById = async (id) => {
  return UniversityDetails.findById(id);
};
const getUniversitiesDetails = async () => {
  return UniversityDetails.find();
};

/**
 * Update booking by id
 * @param {ObjectId} id
 * @param {Object} updateBody
 * @returns {Promise<User>}
 */
const updateUniversitiesDetailsById = async (id, updateBody) => {
  const university = await getUniversitiesDetailsById(id);
  if (!university) {
    throw new ApiError(httpStatus.NOT_FOUND, 'University Details not found');
  }
  Object.assign(university, updateBody);
  await university.save();
  return university;
};

/**
 * Delete booking by id
 * @param {ObjectId} uniId
 * @returns {Promise<User>}
 */
const deleteUniversitiesDetailsById = async (uniId) => {
  const university = await getUniversitiesDetailsById(uniId);
  if (!university) {
    throw new ApiError(httpStatus.NOT_FOUND, 'University not found');
  }
  await university.remove();
  return university;
};

const searchUniversitiesDetails = async (text, options) => {
  // eslint-disable-next-line security/detect-non-literal-regexp
  const regex = new RegExp(text, 'i');
  const uni = await UniversityDetails.paginate(
    { $and: [{ status: 'Paid', $or: [{ fullname: regex }, { phoneNumber: regex }, { email: regex }] }] },
    options
  );
  return uni;
};

module.exports = {
  createUniversitiesDetails,
  queryUniversitiesDetails,
  getUniversitiesDetails,
  updateUniversitiesDetailsById,
  deleteUniversitiesDetailsById,
  getUniversitiesDetailsById,
  searchUniversitiesDetails,
  getUniversitiesDetailsByRef,
};
