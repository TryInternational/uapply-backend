const httpStatus = require('http-status');
const ApiError = require('../utils/ApiError');
const pick = require('../utils/pick');
const { aptitudeTestService } = require('../services');

/**
 * Create a new aptitude test result
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware
 */
const createAptitudeTest = async (req, res, next) => {
  try {
    const testResult = await aptitudeTestService.createAptitudeTest(req.body);
    res.status(httpStatus.CREATED).json({
      success: true,
      data: testResult,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get all aptitude test results
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware
 */
const getAptitudeTests = async (req, res, next) => {
  try {
    const filter = pick(req.query, ['name', 'number', 'testType', 'language', 'destination', 'degree']);
    const options = pick(req.query, ['sortBy', 'limit', 'page']);
    const result = await aptitudeTestService.getAptitudeTests(filter, options);
    res.send({
      success: true,
      results: result.results,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
      totalResults: result.totalResults,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get a single aptitude test result by ID
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware
 */
const getAptitudeTest = async (req, res, next) => {
  try {
    const test = await aptitudeTestService.getAptitudeTestById(req.params.id);
    if (!test) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Aptitude test not found');
    }
    res.json({
      success: true,
      data: test,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update an aptitude test result by ID
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware
 */
const updateAptitudeTest = async (req, res, next) => {
  try {
    const test = await aptitudeTestService.updateAptitudeTest(req.params.id, req.body);
    if (!test) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Aptitude test not found');
    }
    res.json({
      success: true,
      data: test,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Delete an aptitude test result by ID
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware
 */
const deleteAptitudeTest = async (req, res, next) => {
  try {
    const test = await aptitudeTestService.deleteAptitudeTest(req.params.id);
    if (!test) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Aptitude test not found');
    }
    res.status(httpStatus.NO_CONTENT).send();
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createAptitudeTest,
  getAptitudeTests,
  getAptitudeTest,
  updateAptitudeTest,
  deleteAptitudeTest,
};
