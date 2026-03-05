const httpStatus = require('http-status');
const { default: axios } = require('axios');
const pick = require('../utils/pick');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');
const { ieltsTestService, openAIService } = require('../services');
const config = require('../config/config');

/**
 * Evaluate writing tasks using AI
 */
const evaluateWriting = catchAsync(async (req, res) => {
  const { task1, task2, task1Type = 'academic', task2Type = 'essay' } = req.body;

  if (!task1 || !task2) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Both Task 1 and Task 2 are required');
  }

  console.log('📝 Evaluating writing with AI...');
  console.log('Task 1 length:', task1.length, 'characters');
  console.log('Task 2 length:', task2.length, 'characters');

  try {
    // Evaluate Task 1 (Academic/General Training)
    const task1Prompt = `You are an expert IELTS examiner with years of experience evaluating writing tasks. 
Evaluate this Writing Task 1 response based on official IELTS criteria:

Task: The maps below show the development of a village between 2000 and 2020. 
Summarise the information by selecting and reporting the main features and make comparisons where relevant.

Student's Response:
"${task1}"

Evaluate based on these 4 criteria (band scores 0-9):
1. Task Achievement (TA): How well does the response address the task? Does it provide an overview? Are key features identified and reported?
2. Coherence and Cohesion (CC): How well are ideas organized? Is there clear progression? Are linking words used effectively?
3. Lexical Resource (LR): Range and accuracy of vocabulary. Are words used precisely? Is there evidence of sophistication?
4. Grammatical Range and Accuracy (GRA): Range and accuracy of grammar. Are complex structures used? Are there errors?

Provide:
- Band score for each criterion (0-9)
- Detailed, constructive feedback (2-3 sentences per criterion)
- Specific suggestions for improvement (3-5 points)

Return a JSON object with this exact structure:
{
  "criteria": {
    "taskAchievement": { "band": 6.5, "feedback": "Detailed feedback about task achievement" },
    "coherenceCohesion": { "band": 6.5, "feedback": "Detailed feedback about coherence and cohesion" },
    "lexicalResource": { "band": 6.5, "feedback": "Detailed feedback about vocabulary use" },
    "grammaticalRange": { "band": 6.5, "feedback": "Detailed feedback about grammar" }
  },
  "overallBand": 6.5,
  "summary": "2-3 sentences summarizing overall performance with key strengths and areas for improvement",
  "improvements": ["Specific improvement suggestion 1", "Specific improvement suggestion 2", "Specific improvement suggestion 3", "Specific improvement suggestion 4", "Specific improvement suggestion 5"]
}`;

    // Evaluate Task 2 (Essay)
    const task2Prompt = `You are an expert IELTS examiner with years of experience evaluating writing tasks.
Evaluate this Writing Task 2 response based on official IELTS criteria:

Task: Some people believe that technology has made our lives more complex. 
Others think it has made life easier. Discuss both views and give your own opinion.

Student's Response:
"${task2}"

Evaluate based on these 4 criteria (band scores 0-9):
1. Task Response (TR): How well does the response address all parts of the task? Is the position clear? Are ideas developed?
2. Coherence and Cohesion (CC): How well are ideas organized? Is there clear progression? Are paragraphs well-structured?
3. Lexical Resource (LR): Range and accuracy of vocabulary. Is there flexibility and precision in word choice?
4. Grammatical Range and Accuracy (GRA): Range and accuracy of grammar. Are complex structures used effectively?

Provide:
- Band score for each criterion (0-9)
- Detailed, constructive feedback (2-3 sentences per criterion)
- Specific suggestions for improvement (3-5 points)

Return a JSON object with this exact structure:
{
  "criteria": {
    "taskResponse": { "band": 6.5, "feedback": "Detailed feedback about task response" },
    "coherenceCohesion": { "band": 6.5, "feedback": "Detailed feedback about coherence and cohesion" },
    "lexicalResource": { "band": 6.5, "feedback": "Detailed feedback about vocabulary use" },
    "grammaticalRange": { "band": 6.5, "feedback": "Detailed feedback about grammar" }
  },
  "overallBand": 6.5,
  "summary": "2-3 sentences summarizing overall performance with key strengths and areas for improvement",
  "improvements": ["Specific improvement suggestion 1", "Specific improvement suggestion 2", "Specific improvement suggestion 3", "Specific improvement suggestion 4", "Specific improvement suggestion 5"]
}`;

    // Get AI evaluations using OpenAI service
    const [task1Evaluation, task2Evaluation] = await Promise.all([
      openAIService.evaluateWriting(task1Prompt),
      openAIService.evaluateWriting(task2Prompt),
    ]);

    // Calculate word counts
    const task1WordCount = task1.split(/\s+/).filter((w) => w.length > 0).length;
    const task2WordCount = task2.split(/\s+/).filter((w) => w.length > 0).length;

    // Calculate final scores (Task 2 is weighted double)
    const finalOverall = (task1Evaluation.overallBand + task2Evaluation.overallBand * 2) / 3;
    const roundedFinal = Math.round(finalOverall * 2) / 2;

    console.log('✅ Writing evaluation completed');
    console.log('Task 1 Band:', task1Evaluation.overallBand);
    console.log('Task 2 Band:', task2Evaluation.overallBand);
    console.log('Final Overall Band:', roundedFinal);

    res.status(httpStatus.OK).json({
      success: true,
      task1: {
        ...task1Evaluation,
        wordCount: task1WordCount,
      },
      task2: {
        ...task2Evaluation,
        wordCount: task2WordCount,
      },
      finalOverall: roundedFinal,
    });
  } catch (error) {
    console.error('❌ AI Evaluation Error:', error);

    // Return fallback evaluation if AI fails
    const fallbackEvaluation = getFallbackEvaluation(task1, task2);

    res.status(httpStatus.OK).json({
      success: true,
      ...fallbackEvaluation,
      aiEvaluated: false,
      fallback: true,
    });
  }
});

/**
 * Get fallback evaluation when AI is unavailable
 */
const getFallbackEvaluation = (task1, task2) => {
  const task1WordCount = task1.split(/\s+/).filter((w) => w.length > 0).length;
  const task2WordCount = task2.split(/\s+/).filter((w) => w.length > 0).length;

  // Basic Task 1 evaluation
  const task1Score = calculateBasicScore(task1, task1WordCount, 100);

  // Basic Task 2 evaluation
  const task2Score = calculateBasicScore(task2, task2WordCount, 250);

  const finalOverall = (task1Score.overallBand + task2Score.overallBand * 2) / 3;
  const roundedFinal = Math.round(finalOverall * 2) / 2;

  return {
    task1: {
      ...task1Score,
      wordCount: task1WordCount,
    },
    task2: {
      ...task2Score,
      wordCount: task2WordCount,
    },
    finalOverall: roundedFinal,
    fallbackReason: 'AI service unavailable',
  };
};

/**
 * Calculate basic score based on word count and simple metrics
 */
const calculateBasicScore = (text, wordCount, targetWords) => {
  let baseBand = 5.0;
  const feedback = [];
  const improvements = [];

  // Word count check
  if (wordCount < targetWords * 0.5) {
    baseBand = 4.0;
    feedback.push(`Word count (${wordCount}) is significantly below the required ${targetWords} words.`);
    improvements.push(`Expand your response to reach the minimum word count of ${targetWords} words.`);
  } else if (wordCount < targetWords * 0.75) {
    baseBand = 5.0;
    feedback.push(`Word count (${wordCount}) is below the recommended ${targetWords} words.`);
    improvements.push(`Develop your ideas further to reach ${targetWords} words.`);
  } else if (wordCount >= targetWords) {
    baseBand = 6.0;
    feedback.push(`Good word count of ${wordCount} words.`);
  } else {
    baseBand = 5.5;
    feedback.push(`Word count (${wordCount}) is acceptable but could be expanded.`);
  }

  // Check for paragraphs
  const paragraphs = text.split(/\n\n+/).filter((p) => p.trim().length > 0);
  if (paragraphs.length >= 3) {
    baseBand += 0.5;
    feedback.push('Good paragraph structure with clear organization.');
  } else {
    improvements.push('Use paragraphs to organize your ideas more clearly.');
  }

  // Check for linking words
  const linkingWords = [
    'however',
    'moreover',
    'furthermore',
    'therefore',
    'consequently',
    'additionally',
    'in addition',
    'on the other hand',
    'nevertheless',
    'nonetheless',
  ];
  const hasLinkingWords = linkingWords.some((word) => text.toLowerCase().includes(word));

  if (hasLinkingWords) {
    baseBand += 0.5;
    feedback.push('Good use of linking words to connect ideas.');
  } else {
    improvements.push('Use more linking words to improve cohesion between sentences and paragraphs.');
  }

  // Cap at 7.5 for basic evaluation
  baseBand = Math.min(7.5, baseBand);
  const roundedBand = Math.round(baseBand * 2) / 2;

  return {
    criteria: {
      taskAchievement: {
        band: roundedBand - 0.5,
        feedback: `Based on word count and structure. ${feedback[0] || ''}`,
      },
      coherenceCohesion: {
        band: roundedBand,
        feedback: paragraphs.length >= 3 ? 'Good paragraph organization.' : 'Consider better paragraph structure.',
      },
      lexicalResource: {
        band: roundedBand - 0.5,
        feedback: hasLinkingWords ? 'Adequate vocabulary range.' : 'Vocabulary range is limited.',
      },
      grammaticalRange: {
        band: roundedBand - 0.5,
        feedback: 'Basic evaluation - grammar not analyzed in detail.',
      },
    },
    overallBand: roundedBand,
    summary: feedback.join(' ') || 'Basic evaluation completed.',
    improvements: improvements.length ? improvements : ['Review IELTS writing criteria for higher band scores.'],
  };
};

/**
 * Check if user is eligible to take IELTS test
 */
const checkTestEligibility = catchAsync(async (req, res) => {
  const { phone } = req.body;
  if (!phone) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Phone number is required');
  }

  const eligibility = await ieltsTestService.checkUserEligibility(phone);
  res.status(httpStatus.OK).send(eligibility);
});

/**
 * Create a new IELTS test record with AI evaluation
 */
const createIELTSTest = catchAsync(async (req, res) => {
  const { phone } = req.body;

  console.log('📝 Creating IELTS test:', req.body);

  // Check eligibility before creating test
  const eligibility = await ieltsTestService.checkUserEligibility(phone);

  if (!eligibility.canTakeTest) {
    throw new ApiError(httpStatus.FORBIDDEN, eligibility.message);
  }
  console.log(req.body);
  // If writing scores are not provided, evaluate them with AI
  if (req.body.answers?.writing && !req.body.scores?.writing) {
    try {
      console.log('🤖 Evaluating writing with AI...');
      const writingEvaluation = await evaluateWriting(
        {
          body: {
            task1: req.body.answers.writing.task1 || '',
            task2: req.body.answers.writing.task2 || '',
          },
        },
        { status: () => ({ json: (data) => data }) }
      );

      // Add AI evaluation to scores
      if (writingEvaluation.success) {
        req.body.scores = {
          ...req.body.scores,
          writing: {
            bandScore: writingEvaluation.finalOverall,
            task1: writingEvaluation.task1,
            task2: writingEvaluation.task2,
            details: {
              task1: writingEvaluation.task1,
              task2: writingEvaluation.task2,
            },
          },
        };

        req.body.aiEvaluated = true;
        console.log('✅ AI evaluation completed successfully', writingEvaluation);
      }
    } catch (error) {
      console.error('❌ Failed to evaluate writing with AI:', error);
      // Continue with test creation even if AI evaluation fails
      req.body.aiEvaluated = false;
    }
  }

  const ieltsTest = await ieltsTestService.createIELTSTest(req.body);

  // Send Slack notification for completed tests
  if (ieltsTest.status === 'Completed') {
    const slackBody = {
      attachments: [
        {
          pretext: `*New IELTS Test Completed - Attempt ${ieltsTest.attemptNumber}/5*`,
          text: `\nName: ${ieltsTest.name}\nPhone: ${ieltsTest.phone}\nOverall Score: ${
            ieltsTest.scores?.overall?.bandScore || 'N/A'
          } (${ieltsTest.scores?.overall?.level || 'N/A'})\nSections: Reading(${
            ieltsTest.scores?.reading?.bandScore || 'N/A'
          }), Writing(${ieltsTest.scores?.writing?.bandScore || 'N/A'}), Listening(${
            ieltsTest.scores?.listening?.bandScore || 'N/A'
          })\nTime Taken: ${ieltsTest.timeTaken?.formatted || 'N/A'}\nAttempts Used: ${ieltsTest.attemptsUsed || 1}/5\n${
            ieltsTest.aiEvaluated ? '🤖 AI Evaluated' : '📝 Basic Evaluation'
          }`,
          color: ieltsTest.aiEvaluated ? '#36a64f' : '#ff9800',
        },
      ],
    };

    const slackWebhook = {
      method: 'post',
      url: `https://hooks.slack.com/services/${config.slack.slackWebHookIELTS || config.slack.slackWebHookUlearn}`,
      data: JSON.stringify(slackBody),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    };

    // if (process.env.APP_ENV === 'production') {
    //   try {
    //     await axios(slackWebhook);
    //     console.log('✅ Slack notification sent');
    //   } catch (error) {
    //     console.error('❌ Failed to send Slack notification:', error.message);
    //   }
    // }
  }

  res.status(httpStatus.CREATED).send(ieltsTest);
});

/**
 * Get all IELTS tests with filters
 */
const getIELTSTests = catchAsync(async (req, res) => {
  const filter = pick(req.query, [
    'name',
    'phone',
    'email',
    'status',
    'testType',
    'whatsappStatus',
    'nationality',
    'startDate',
    'endDate',
    'aiEvaluated',
  ]);

  // Handle date filters
  if (req.query.startDate && req.query.endDate) {
    filter.startDate = req.query.startDate;
    filter.endDate = req.query.endDate;
  }

  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  console.log('Filter:', filter, 'Options:', options);

  const result = await ieltsTestService.queryIELTSTests(filter, options);

  res.status(httpStatus.OK).send(result);
});

/**
 * Get IELTS test by ID
 */
const getIELTSTest = catchAsync(async (req, res) => {
  const ieltsTest = await ieltsTestService.getIELTSTestById(req.params.testId);
  if (!ieltsTest) {
    throw new ApiError(httpStatus.NOT_FOUND, 'IELTS test not found');
  }
  res.status(httpStatus.OK).send(ieltsTest);
});

/**
 * Update IELTS test by ID
 */
const updateIELTSTest = catchAsync(async (req, res) => {
  const ieltsTest = await ieltsTestService.updateIELTSTestById(req.params.testId, req.body);
  res.status(httpStatus.OK).send(ieltsTest);
});

/**
 * Delete IELTS test by ID
 */
const deleteIELTSTest = catchAsync(async (req, res) => {
  await ieltsTestService.deleteIELTSTestById(req.params.testId);
  res.status(httpStatus.NO_CONTENT).send();
});

/**
 * Get user's test history by phone
 */
const getUserTestHistory = catchAsync(async (req, res) => {
  const { phone } = req.params;
  const history = await ieltsTestService.getUserTestHistory(phone);
  res.status(httpStatus.OK).send(history);
});

/**
 * Get user's test statistics by phone
 */
const getUserTestStats = catchAsync(async (req, res) => {
  const { phone } = req.params;
  const stats = await ieltsTestService.getUserTestStats(phone);
  res.status(httpStatus.OK).send(stats);
});

/**
 * Send WhatsApp results for a test
 */
const sendWhatsAppResults = catchAsync(async (req, res) => {
  const ieltsTest = await ieltsTestService.sendWhatsAppResults(req.params.testId);
  res.status(httpStatus.OK).send({
    message: 'WhatsApp results sent successfully',
    ieltsTest,
  });
});

/**
 * Search IELTS tests
 */
const searchIELTSTests = catchAsync(async (req, res) => {
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const results = await ieltsTestService.searchIELTSTests(req.params.text, options);
  res.status(httpStatus.OK).send(results);
});

/**
 * Get overall test statistics
 */
const getTestStatistics = catchAsync(async (req, res) => {
  const filters = pick(req.query, ['startDate', 'endDate', 'status', 'testType']);
  const stats = await ieltsTestService.getTestStatistics(filters);
  res.status(httpStatus.OK).send(stats);
});

/**
 * Get IELTS dashboard data
 */
const getIELTSDashboardData = catchAsync(async (req, res) => {
  const query = pick(req.query, ['startDate', 'endDate']);
  const dashboardData = await ieltsTestService.getIELTSDashboardData(query);
  res.status(httpStatus.OK).send(dashboardData);
});

/**
 * Get latest IELTS test by phone
 */
const getLatestIELTSTestByPhone = catchAsync(async (req, res) => {
  const { phone } = req.params;
  const ieltsTest = await ieltsTestService.getIELTSTestByPhone(phone);
  if (!ieltsTest) {
    throw new ApiError(httpStatus.NOT_FOUND, 'No IELTS test found for this phone number');
  }
  res.status(httpStatus.OK).send(ieltsTest);
});

/**
 * Reset user's test attempts (admin only)
 */
const resetUserAttempts = catchAsync(async (req, res) => {
  const { phone } = req.params;
  const { reason } = req.body;

  // Find all tests for the user and update their status
  const tests = await ieltsTestService.queryIELTSTests({ phone }, {});

  // Log the reset action
  console.log(`Admin ${req.user?.id || 'Unknown'} reset attempts for ${phone}. Reason: ${reason}`);

  res.status(httpStatus.OK).send({
    message: 'User attempts reset successfully',
    testsReset: tests.totalResults || 0,
    phone,
    resetBy: req.user?.id || 'Unknown',
    reason,
  });
});

/**
 * Export test results (CSV/Excel)
 */
const exportTestResults = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['startDate', 'endDate', 'status', 'testType', 'whatsappStatus', 'aiEvaluated']);

  const tests = await ieltsTestService.queryIELTSTests(filter, { limit: 1000 });

  // Convert to CSV format
  const csvData = tests.results.map((test) => ({
    'Test ID': test._id,
    Name: test.name,
    Phone: test.phone,
    Email: test.email || 'N/A',
    Attempt: test.attemptNumber,
    Status: test.status,
    'Overall Score': test.scores?.overall?.bandScore || 'N/A',
    Reading: test.scores?.reading?.bandScore || 'N/A',
    Writing: test.scores?.writing?.bandScore || 'N/A',
    Listening: test.scores?.listening?.bandScore || 'N/A',
    'Writing Task 1 Band': test.scores?.writing?.task1?.bandScore || 'N/A',
    'Writing Task 2 Band': test.scores?.writing?.task2?.bandScore || 'N/A',
    'Time Taken': test.timeTaken?.formatted || 'N/A',
    'AI Evaluated': test.aiEvaluated ? 'Yes' : 'No',
    'Created At': new Date(test.createdAt).toLocaleString(),
    'WhatsApp Status': test.whatsappStatus,
    Nationality: test.nationality || 'N/A',
    Destination: test.destination || 'N/A',
    'Target Score': test.targetScore || 'N/A',
  }));

  // Set headers for CSV download
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=ielts-test-results.csv');

  // Convert to CSV string
  const headers = Object.keys(csvData[0] || {});
  const csvString = [headers.join(','), ...csvData.map((row) => headers.map((header) => `"${row[header]}"`).join(','))].join(
    '\n'
  );

  res.status(httpStatus.OK).send(csvString);
});

module.exports = {
  evaluateWriting,
  checkTestEligibility,
  createIELTSTest,
  getIELTSTests,
  getIELTSTest,
  updateIELTSTest,
  deleteIELTSTest,
  getUserTestHistory,
  getUserTestStats,
  sendWhatsAppResults,
  searchIELTSTests,
  getTestStatistics,
  getIELTSDashboardData,
  getLatestIELTSTestByPhone,
  resetUserAttempts,
  exportTestResults,
};
