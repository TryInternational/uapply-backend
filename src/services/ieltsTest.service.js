const httpStatus = require('http-status');
const { DateTime } = require('luxon');
const { IeltsTest } = require('../models');
const ApiError = require('../utils/ApiError');
const { convertASTToUTC } = require('../utils/Common');

/**
 * Check if user is eligible to take the test
 * @param {string} phone
 * @returns {Promise<Object>}
 */
const checkUserEligibility = async (phone) => {
  console.log('phone', phone);
  return await IeltsTest.canUserTakeTest(phone);
};

/**
 * Create an IELTS test record
 * @param {Object} ieltsTestBody
 * @returns {Promise<IeltsTest>}
 */
const createIELTSTest = async (ieltsTestBody) => {
  const { phone } = ieltsTestBody;

  // Double-check eligibility before creating
  const eligibility = await checkUserEligibility(phone);
  if (!eligibility.canTakeTest) {
    throw new ApiError(httpStatus.FORBIDDEN, eligibility.message);
  }

  // Get next attempt number
  const nextAttempt = await IeltsTest.getNextAttemptNumber(phone);
  ieltsTestBody.attemptNumber = nextAttempt;
  ieltsTestBody.isFirstAttempt = nextAttempt === 1;
  ieltsTestBody.isLastAttempt = nextAttempt === 5;

  // Calculate overall score if not provided
  if (ieltsTestBody.scores && !ieltsTestBody.scores.overall) {
    const { reading, writing, listening } = ieltsTestBody.scores;
    if (reading && writing && listening) {
      const average = (reading.bandScore + writing.bandScore + listening.bandScore) / 3;
      const bandScore = Math.round(average * 2) / 2;

      let level;
      if (bandScore >= 8.5) level = 'Expert User';
      else if (bandScore >= 7.5) level = 'Very Good User';
      else if (bandScore >= 6.5) level = 'Good User';
      else if (bandScore >= 5.5) level = 'Competent User';
      else if (bandScore >= 4.5) level = 'Modest User';
      else level = 'Limited User';

      ieltsTestBody.scores.overall = {
        bandScore,
        level,
      };
    }
  }

  // Set completion time if test is completed
  if (ieltsTestBody.status === 'Completed' && !ieltsTestBody.completedAt) {
    ieltsTestBody.completedAt = new Date();
    ieltsTestBody.endTime = new Date();
  }

  return IeltsTest.create(ieltsTestBody);
};

/**
 * Query for IELTS tests with pagination
 * @param {Object} filter - Mongo filter
 * @param {Object} options - Query options
 * @param {string} [options.sortBy] - Sort option in the format: sortField:(desc|asc)
 * @param {number} [options.limit] - Maximum number of results per page (default = 10)
 * @param {number} [options.page] - Current page (default = 1)
 * @returns {Promise<QueryResult>}
 */
const queryIELTSTests = async (filter, options) => {
  // Handle date filters
  if (filter.startDate && filter.endDate) {
    const startDate = DateTime.fromISO(new Date(filter.startDate).toISOString(), {
      zone: 'Asia/Riyadh',
    }).startOf('day');
    const endDate = DateTime.fromISO(new Date(filter.endDate).toISOString(), {
      zone: 'Asia/Riyadh',
    }).endOf('day');

    const sd = convertASTToUTC(startDate, true).toString();
    const ed = convertASTToUTC(endDate, true).toString();

    filter.createdAt = {
      $gte: sd,
      $lte: ed,
    };
    delete filter.startDate;
    delete filter.endDate;
  }

  return IeltsTest.paginate(filter, options);
};

/**
 * Get IELTS test by ID
 * @param {ObjectId} id
 * @returns {Promise<IELTSTest>}
 */
const getIELTSTestById = async (id) => {
  return IeltsTest.findById(id);
};

/**
 * Get IELTS test by phone number (latest)
 * @param {string} phone
 * @returns {Promise<IELTSTest>}
 */
const getIELTSTestByPhone = async (phone) => {
  return IeltsTest.findOne({ phone }).sort({ createdAt: -1 });
};

/**
 * Update IELTS test by ID
 * @param {ObjectId} testId
 * @param {Object} updateBody
 * @returns {Promise<IELTSTest>}
 */
const updateIELTSTestById = async (testId, updateBody) => {
  const ieltsTest = await getIELTSTestById(testId);
  if (!ieltsTest) {
    throw new ApiError(httpStatus.NOT_FOUND, 'IELTS test not found');
  }

  // If updating to completed status, calculate overall score if not present
  if (updateBody.status === 'Completed' && !updateBody.completedAt) {
    updateBody.completedAt = new Date();
    updateBody.endTime = new Date();

    // Calculate overall score if not provided
    if (!(updateBody.scores && updateBody.scores.overall) && ieltsTest.scores) {
      const { reading, writing, listening } = ieltsTest.scores;
      if (reading && writing && listening) {
        const average = (reading.bandScore + writing.bandScore + listening.bandScore) / 3;
        const bandScore = Math.round(average * 2) / 2;

        let level;
        if (bandScore >= 8.5) level = 'Expert User';
        else if (bandScore >= 7.5) level = 'Very Good User';
        else if (bandScore >= 6.5) level = 'Good User';
        else if (bandScore >= 5.5) level = 'Competent User';
        else if (bandScore >= 4.5) level = 'Modest User';
        else level = 'Limited User';

        if (!updateBody.scores) updateBody.scores = {};
        updateBody.scores.overall = {
          bandScore,
          level,
        };
      }
    }
  }

  Object.assign(ieltsTest, updateBody);
  await ieltsTest.save();
  return ieltsTest;
};

/**
 * Delete IELTS test by ID
 * @param {ObjectId} testId
 * @returns {Promise<IELTSTest>}
 */
const deleteIELTSTestById = async (testId) => {
  const ieltsTest = await getIELTSTestById(testId);
  if (!ieltsTest) {
    throw new ApiError(httpStatus.NOT_FOUND, 'IELTS test not found');
  }
  await ieltsTest.remove();
  return ieltsTest;
};

/**
 * Get user's test history
 * @param {string} phone
 * @returns {Promise<Array>}
 */
const getUserTestHistory = async (phone) => {
  return IeltsTest.find({ phone })
    .sort({ createdAt: -1 })
    .select('attemptNumber scores.overall.bandScore scores.overall.level status createdAt timeTaken.formatted');
};

/**
 * Get user's test statistics
 * @param {string} phone
 * @returns {Promise<Object>}
 */
const getUserTestStats = async (phone) => {
  const tests = await IeltsTest.find({ phone, status: 'Completed' });

  if (tests.length === 0) {
    return {
      totalTests: 0,
      attemptsLeft: 5,
      attemptsUsed: 0,
      averageScore: 0,
      bestScore: 0,
      progress: [],
    };
  }

  const totalTests = tests.length;
  const attemptsLeft = Math.max(0, 5 - totalTests);
  const scores = tests.map((test) => test.scores.overall.bandScore);
  const averageScore = scores.reduce((a, b) => a + b, 0) / scores.length;
  const bestScore = Math.max(...scores);
  const worstScore = Math.min(...scores);

  // Calculate section averages
  const readingScores = tests.map((test) => test.scores.reading.bandScore).filter((score) => score != null);
  const writingScores = tests.map((test) => test.scores.writing.bandScore).filter((score) => score != null);
  const listeningScores = tests.map((test) => test.scores.listening.bandScore).filter((score) => score != null);

  const readingAvg = readingScores.length > 0 ? readingScores.reduce((a, b) => a + b, 0) / readingScores.length : 0;
  const writingAvg = writingScores.length > 0 ? writingScores.reduce((a, b) => a + b, 0) / writingScores.length : 0;
  const listeningAvg = listeningScores.length > 0 ? listeningScores.reduce((a, b) => a + b, 0) / listeningScores.length : 0;

  // Calculate progress over time
  const progress = tests
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((test, index) => ({
      attemptNumber: index + 1,
      bandScore: test.scores.overall.bandScore,
      date: test.createdAt,
      timeTaken: test.timeTaken && test.timeTaken.formatted ? test.timeTaken.formatted : 'N/A',
      reading: test.scores.reading.bandScore,
      writing: test.scores.writing.bandScore,
      listening: test.scores.listening.bandScore,
    }));

  // Get most recent test
  const lastTest = tests.sort((a, b) => b.createdAt - a.createdAt)[0];

  return {
    totalTests,
    attemptsLeft,
    attemptsUsed: totalTests,
    averageScore: Math.round(averageScore * 10) / 10,
    bestScore,
    worstScore,
    sectionAverages: {
      reading: Math.round(readingAvg * 10) / 10,
      writing: Math.round(writingAvg * 10) / 10,
      listening: Math.round(listeningAvg * 10) / 10,
    },
    progress,
    lastTestDate: lastTest.createdAt,
    lastTestScore: lastTest.scores.overall.bandScore,
    isMaxAttemptsReached: totalTests >= 5,
  };
};

/**
 * Send WhatsApp results
 * @param {ObjectId} testId
 * @returns {Promise<IELTSTest>}
 */
const sendWhatsAppResults = async (testId) => {
  const ieltsTest = await getIELTSTestById(testId);
  if (!ieltsTest) {
    throw new ApiError(httpStatus.NOT_FOUND, 'IELTS test not found');
  }

  if (ieltsTest.status !== 'Completed') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Cannot send results for incomplete test');
  }

  const message = `Your IELTS Test Results (Attempt ${ieltsTest.attemptNumber}/5):

Overall Band Score: ${ieltsTest.scores.overall.bandScore}
Level: ${ieltsTest.scores.overall.level}

Section Scores:
- Reading: ${ieltsTest.scores.reading.bandScore}
- Writing: ${ieltsTest.scores.writing.bandScore}
- Listening: ${ieltsTest.scores.listening.bandScore}

Time Taken: ${ieltsTest.timeTaken && ieltsTest.timeTaken.formatted ? ieltsTest.timeTaken.formatted : 'N/A'}

Attempts Used: ${ieltsTest.attemptsUsed}/5
Attempts Left: ${ieltsTest.attemptsLeft}

${
  ieltsTest.meetsTarget
    ? '🎉 Congratulations! You have met your target score!'
    : 'Keep practicing to reach your target score!'
}

View detailed analysis: [Your Website URL]`;

  // TODO: Integrate with WhatsApp API
  // Example:
  // await whatsAppService.sendMessage(ieltsTest.phone, message);

  // For now, simulate sending
  console.log(`WhatsApp message to ${ieltsTest.phone}:`, message);

  ieltsTest.whatsappStatus = 'Sent';
  ieltsTest.whatsappSentAt = new Date();
  await ieltsTest.save();

  return ieltsTest;
};

/**
 * Search IELTS tests
 * @param {string} text - Search text
 * @param {Object} options - Query options
 * @returns {Promise<QueryResult>}
 */
const searchIELTSTests = async (text, options) => {
  const regex = new RegExp(text, 'i');
  return IeltsTest.paginate(
    {
      $or: [
        { name: regex },
        { phone: regex },
        { email: regex },
        { destination: regex },
        { nationality: regex },
        { 'scores.overall.level': regex },
      ],
    },
    options
  );
};

/**
 * Count IELTS tests with filters
 * @param {Object} filter - Filter criteria
 * @returns {Promise<number>}
 */
const countIELTSTests = async (filter) => {
  return IeltsTest.countDocuments(filter);
};

/**
 * Get overall test statistics
 * @returns {Promise<Object>}
 */
const getTestStatistics = async (filters = {}) => {
  const matchQuery = {};

  // Apply filters
  if (filters.startDate && filters.endDate) {
    const startDate = DateTime.fromISO(new Date(filters.startDate).toISOString(), {
      zone: 'Asia/Riyadh',
    }).startOf('day');
    const endDate = DateTime.fromISO(new Date(filters.endDate).toISOString(), {
      zone: 'Asia/Riyadh',
    }).endOf('day');

    const sd = convertASTToUTC(startDate, true).toString();
    const ed = convertASTToUTC(endDate, true).toString();

    matchQuery.createdAt = {
      $gte: sd,
      $lte: ed,
    };
  }

  if (filters.status) {
    matchQuery.status = filters.status;
  }

  if (filters.testType) {
    matchQuery.testType = filters.testType;
  }

  const [
    totalTests,
    completedTests,
    maxAttemptsReached,
    inProgressTests,
    averageScore,
    scoreDistribution,
    attemptsDistribution,
    topCountries,
    topScores,
  ] = await Promise.all([
    IeltsTest.countDocuments(matchQuery),
    IeltsTest.countDocuments({ ...matchQuery, status: 'Completed' }),
    IeltsTest.countDocuments({ ...matchQuery, status: 'Max Attempts Reached' }),
    IeltsTest.countDocuments({ ...matchQuery, status: 'In Progress' }),
    IeltsTest.aggregate([
      { $match: { ...matchQuery, status: 'Completed' } },
      { $group: { _id: null, avgScore: { $avg: '$scores.overall.bandScore' } } },
    ]),
    IeltsTest.aggregate([
      { $match: { ...matchQuery, status: 'Completed' } },
      {
        $bucket: {
          groupBy: '$scores.overall.bandScore',
          boundaries: [0, 4, 5, 6, 7, 8, 9, 10],
          default: 'Other',
          output: {
            count: { $sum: 1 },
            average: { $avg: '$scores.overall.bandScore' },
          },
        },
      },
    ]),
    IeltsTest.aggregate([
      { $match: { ...matchQuery, status: 'Completed' } },
      {
        $group: {
          _id: '$attemptNumber',
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    IeltsTest.aggregate([
      { $match: { ...matchQuery, status: 'Completed', nationality: { $exists: true, $ne: null } } },
      {
        $group: {
          _id: '$nationality',
          country: { $first: '$nationality' },
          count: { $sum: 1 },
          avgScore: { $avg: '$scores.overall.bandScore' },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 5 },
    ]),
    IeltsTest.find({ ...matchQuery, status: 'Completed' })
      .sort({ 'scores.overall.bandScore': -1 })
      .limit(10)
      .select('name phone scores.overall.bandScore scores.overall.level attemptNumber createdAt'),
  ]);

  // Calculate daily trend for last 30 days
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const dailyTrend = await IeltsTest.aggregate([
    {
      $match: {
        ...matchQuery,
        status: 'Completed',
        createdAt: { $gte: thirtyDaysAgo },
      },
    },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
        },
        count: { $sum: 1 },
        avgScore: { $avg: '$scores.overall.bandScore' },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  return {
    totalTests,
    completedTests,
    maxAttemptsReached,
    inProgressTests,
    expiredTests: totalTests - completedTests - inProgressTests - maxAttemptsReached,
    averageScore: averageScore[0]?.avgScore ? Math.round(averageScore[0].avgScore * 10) / 10 : 0,
    scoreDistribution,
    attemptsDistribution,
    topCountries,
    topScores,
    dailyTrend,
  };
};

/**
 * Get dashboard data for IELTS tests
 * @param {Object} query
 * @returns {Promise<Object>}
 */
const getIELTSDashboardData = async (query = {}) => {
  const { startDate, endDate } = query;

  const [
    totalTests,
    completedTests,
    inProgressTests,
    maxAttemptsReached,
    averageScore,
    topCountries,
    dailyTrend,
    scoreDistribution,
    whatsAppStats,
  ] = await Promise.all([
    countIELTSTests({ startDate, endDate }),
    countIELTSTests({ startDate, endDate, status: 'Completed' }),
    countIELTSTests({ startDate, endDate, status: 'In Progress' }),
    countIELTSTests({ startDate, endDate, status: 'Max Attempts Reached' }),
    getTestStatistics({ startDate, endDate }),
    IeltsTest.aggregate([
      {
        $match: {
          status: 'Completed',
          ...(startDate && endDate
            ? {
                createdAt: {
                  $gte: new Date(startDate),
                  $lte: new Date(endDate),
                },
              }
            : {}),
        },
      },
      {
        $group: {
          _id: '$nationality',
          count: { $sum: 1 },
          avgScore: { $avg: '$scores.overall.bandScore' },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 5 },
    ]),
    IeltsTest.aggregate([
      {
        $match: {
          status: 'Completed',
          createdAt: {
            $gte: new Date(new Date().setDate(new Date().getDate() - 30)),
            $lte: new Date(),
          },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    IeltsTest.aggregate([
      {
        $match: {
          status: 'Completed',
          ...(startDate && endDate
            ? {
                createdAt: {
                  $gte: new Date(startDate),
                  $lte: new Date(endDate),
                },
              }
            : {}),
        },
      },
      {
        $bucket: {
          groupBy: '$scores.overall.bandScore',
          boundaries: [0, 5, 6, 7, 8, 9, 10],
          default: 'Other',
          output: {
            count: { $sum: 1 },
            min: { $min: '$scores.overall.bandScore' },
            max: { $max: '$scores.overall.bandScore' },
            avg: { $avg: '$scores.overall.bandScore' },
          },
        },
      },
    ]),
    IeltsTest.aggregate([
      {
        $match: {
          ...(startDate && endDate
            ? {
                createdAt: {
                  $gte: new Date(startDate),
                  $lte: new Date(endDate),
                },
              }
            : {}),
        },
      },
      {
        $group: {
          _id: '$whatsappStatus',
          count: { $sum: 1 },
        },
      },
    ]),
  ]);

  return {
    overview: {
      totalTests,
      completedTests,
      inProgressTests,
      maxAttemptsReached,
      completionRate: totalTests > 0 ? Math.round((completedTests / totalTests) * 100) : 0,
    },
    scores: {
      averageScore: averageScore.averageScore || 0,
      scoreDistribution: scoreDistribution || [],
    },
    whatsAppStats: {
      sent: whatsAppStats.find((s) => s._id === 'Sent')?.count || 0,
      notSent: whatsAppStats.find((s) => s._id === 'Not Sent')?.count || 0,
      failed: whatsAppStats.find((s) => s._id === 'Failed')?.count || 0,
      total: totalTests,
    },
    topCountries: topCountries || [],
    dailyTrend: dailyTrend || [],
    attempts: {
      firstAttempt: completedTests > 0 ? Math.round((completedTests / totalTests) * 100) : 0,
      averageAttempts: averageScore.attemptsDistribution || [],
    },
  };
};

module.exports = {
  checkUserEligibility,
  createIELTSTest,
  queryIELTSTests,
  getIELTSTestById,
  getIELTSTestByPhone,
  updateIELTSTestById,
  deleteIELTSTestById,
  getUserTestHistory,
  getUserTestStats,
  sendWhatsAppResults,
  searchIELTSTests,
  countIELTSTests,
  getTestStatistics,
  getIELTSDashboardData,
};
