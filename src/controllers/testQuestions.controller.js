/* eslint-disable no-return-assign */
/* eslint-disable eqeqeq */
/* eslint-disable array-callback-return */
const httpStatus = require('http-status');
const { pick } = require('lodash');

const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');

const { testQuestionsService } = require('../services');
// const { fatoorah } = require('../thirdparty');
// const { DateToString } = require('../utils/Common');
// const { PubSub } = require('@google-cloud/pubsub');
// const pubSubClient = new PubSub();

const createTestQuestion = catchAsync(async (req, res) => {
  const subject = await testQuestionsService.createTestQuestion(req.body);

  res.status(httpStatus.CREATED).send(subject);
});

const getTestQuestions = catchAsync(async (req, res) => {
  // await publishMessage();
  const filter = pick(req.query, ['name', 'status', 'stage', 'level', 'course', 'duration', 'ageGroup', 'optionType']);
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'populate']);
  const result = await testQuestionsService.queryTestQuestion(filter, options);
  res.send(result);
});

const getTestQuestion = catchAsync(async (req, res) => {
  const result = await testQuestionsService.getTestQuestionById(req.params.subjectId);
  if (!result) {
    throw new ApiError(httpStatus.NOT_FOUND, 'subject not found');
  }
  res.send(result);
});

const getQuestionsByTestType = async (req, res) => {
  try {
    const questions = await testQuestionsService.getQuestionsByTestType(
      req.params.testType,
      req.params.lang || 'English'
    );
    res.json(questions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const getQuestionsBySection = async (req, res) => {
  try {
    const { testType, section, lang } = req.params;
    const language = lang || 'English';

    // If testType is MathEnglish or MathArabic, ignore the section parameter
    const query = ['MathEnglish', 'MathArabic'].includes(testType)
      ? { testType, language }
      : { testType, section, language };

    const questions = await testQuestionsService.getQuestionsBySection(query);
    res.json(questions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const updateTestQuestion = catchAsync(async (req, res) => {
  const result = await testQuestionsService.updateTestQuestionById(req.params.subjectId, req.body);

  res.send(result);
});

const deleteTestQuestion = catchAsync(async (req, res) => {
  await testQuestionsService.deleteTestQuestionById(req.params.subjectId);
  res.status(httpStatus.NO_CONTENT).send();
});

const searchTestQuestion = catchAsync(async (req, res) => {
  // const filter = pick(req.query, ['name', 'status', 'stage']);
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'populate']);
  const results = await testQuestionsService.searchTestQuestions(req.params.text, options);
  res.status(200).send(results);
});

const deleteQuestionsBySection = catchAsync(async (req, res) => {
  const result = await testQuestionsService.deleteQuestionsBySection(req.params.section);
  res.status(httpStatus.OK).send({
    message: `Successfully deleted ${result.deletedCount} questions from section: ${req.params.section}`,
    deletedCount: result.deletedCount,
  });
});

const deleteQuestionsByTestType = catchAsync(async (req, res) => {
  const result = await testQuestionsService.deleteQuestionsByTestType(req.params.testType);
  res.status(httpStatus.OK).send({
    message: `Successfully deleted ${result.deletedCount} questions with testType: ${req.params.testType}`,
    deletedCount: result.deletedCount,
  });
});

module.exports = {
  createTestQuestion,
  getTestQuestion,
  getTestQuestions,
  deleteTestQuestion,
  updateTestQuestion,
  searchTestQuestion,
  getQuestionsByTestType,
  getQuestionsBySection,
  deleteQuestionsBySection,
  deleteQuestionsByTestType,
};
