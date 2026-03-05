const httpStatus = require('http-status');
const { DateTime } = require('luxon');
const ApiError = require('../utils/ApiError');
const pick = require('../utils/pick');
const { aptitudeTestService } = require('../services');
const catchAsync = require('../utils/catchAsync');

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
    // Extract filters from query
    const filter = pick(req.query, [
      'name',
      'destination',
      'degree',
      'nationality.english_name',
      'status',
      'source',
      'createdAt',
      'testType',
      'score',
    ]);

    // Handle nationality filter
    if (req.query.nationality) {
      filter['nationality.english_name'] = req.query.nationality;
    }

    // Handle destination country filter
    if (req.query.destinationCountry) {
      filter.destination = req.query.destinationCountry;
    }

    // Handle date range filter
    if (req.query.startDate && req.query.endDate) {
      filter.createdAt = {
        $gte: DateTime.fromJSDate(new Date(req.query.startDate), { zone: 'utc' })
          .startOf('day')
          .minus({ hours: 3 })
          .toJSDate(),
        $lte: DateTime.fromJSDate(new Date(req.query.endDate), { zone: 'utc' }).endOf('day').minus({ hours: 3 }).toJSDate(),
      };
    }

    // Handle score range filter
    if (req.query.testScoreMin || req.query.testScoreMax) {
      filter.score = {};

      if (req.query.testScoreMin) {
        filter.score.$gte = parseInt(req.query.testScoreMin);
      }

      if (req.query.testScoreMax) {
        filter.score.$lte = parseInt(req.query.testScoreMax);
      }
    } else if (req.query.score) {
      // For exact score match (if needed)
      filter.score = parseInt(req.query.score);
    }

    // Handle language filter
    if (req.query.language) {
      filter.language = req.query.language;
    }

    // Handle test result filter
    if (req.query.testResult) {
      // If you have a testResult field, add it
      // filter.testResult = req.query.testResult;
    }

    // Extract options including sorting
    const options = pick(req.query, ['sortBy', 'limit', 'page']);

    // Handle sorting - check if sortBy is provided in query params
    if (!options.sortBy && req.query.sortBy) {
      options.sortBy = req.query.sortBy;
    }

    // If no sortBy is specified, set default
    if (!options.sortBy) {
      options.sortBy = '-createdAt'; // Default: newest first
    }

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
const searchAptitudeTest = catchAsync(async (req, res) => {
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'populate', 'qualified', { searchString: req.params.text }]);
  const results = await aptitudeTestService.searchAptitudeTest(req.params.text, options);
  res.status(200).send(results);
});
module.exports = {
  createAptitudeTest,
  getAptitudeTests,
  getAptitudeTest,
  updateAptitudeTest,
  deleteAptitudeTest,
  searchAptitudeTest,
};
