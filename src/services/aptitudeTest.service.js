const AptitudeTest = require('../models/aptitudeTest.model');

/**
 * Create a new aptitude test result
 * @param {Object} testData - The test data to create
 * @returns {Promise<Object>}
 */
const createAptitudeTest = async (testData) => {
  return AptitudeTest.create(testData);
};

/**
 * Get all aptitude tests with optional filtering
 * @param {Object} filters - Mongo filter
 * @param {Object} options - Pagination options
 * @returns {Promise<Object>}
 */
const getAptitudeTests = async (filters, options) => {
  return AptitudeTest.paginate(filters, options);
};

/**
 * Get aptitude test by ID
 * @param {String} id - The test ID
 * @returns {Promise<Object>}
 */
const getAptitudeTestById = async (id) => {
  return AptitudeTest.findById(id);
};

/**
 * Update aptitude test by ID
 * @param {String} id - The test ID
 * @param {Object} updateData - The data to update
 * @returns {Promise<Object>}
 */
const updateAptitudeTest = async (id, updateData) => {
  return AptitudeTest.findByIdAndUpdate(id, updateData, { new: true, runValidators: true });
};

/**
 * Delete aptitude test by ID
 * @param {String} id - The test ID
 * @returns {Promise<Object>}
 */
const deleteAptitudeTest = async (id) => {
  return AptitudeTest.findByIdAndDelete(id);
};
const searchAptitudeTest = async (text, options) => {
  // eslint-disable-next-line security/detect-non-literal-regexp
  const regex = new RegExp(text, 'i');
  const leads = await AptitudeTest.paginate(
    { $and: [{ qualified: options.qualified, $or: [{ name: regex }, { number: regex }, { email: regex }] }] },
    options
  );
  return leads;
};
module.exports = {
  createAptitudeTest,
  getAptitudeTests,
  getAptitudeTestById,
  updateAptitudeTest,
  deleteAptitudeTest,
  searchAptitudeTest,
};
