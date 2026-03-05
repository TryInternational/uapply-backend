const httpStatus = require('http-status');
const { TestQuestion } = require('../models');
const ApiError = require('../utils/ApiError');

/**
 * Create a booking
 * @param {Object} subjectBody
 * @returns {Promise<Subject>}
 */
const createTestQuestion = async (body) => {
  const result = await TestQuestion.create(body);
  return result;
};

const queryTestQuestion = async (filter, options) => {
  const result = await TestQuestion.paginate(filter, options);
  return result;
};

/**
 * @param {ObjectId} id
 * @returns {Promise<User>}
 */
const getTestQuestionById = async (id) => {
  return TestQuestion.findById(id);
};
const getTestQuestions = async () => {
  return TestQuestion.find();
};

const updateTestQuestionById = async (id, updateBody) => {
  const question = await getTestQuestionById(id);
  if (!question) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Subjects not found');
  }
  Object.assign(question, updateBody);
  await question.save();
  return question;
};

/**
 * Delete booking by id
 * @param {ObjectId} subjectId
 * @returns {Promise<User>}
 */
const deleteTestQuestionById = async (id) => {
  const result = await getTestQuestionById(id);
  if (!result) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Subject not found');
  }
  await result.remove();
  return result;
};

/**
 * Delete booking by id
 * @param {ObjectId} subjectId
 * @param {Object} commentBody
 * @returns {Promise<Comment>}
 */

const searchTestQuestions = async (text, options) => {
  // eslint-disable-next-line security/detect-non-literal-regexp
  const regex = new RegExp(text, 'i');
  const subject = await TestQuestion.paginate({ name: regex }, options);
  return subject;
};

const getQuestionsByTestType = async (testType, language) => {
  const result = await TestQuestion.find({ testType, language });
  return result;
};

const getQuestionsBySection = async (data) => {
  const result = await TestQuestion.find({ testType: data.testType, section: data.section, language: data.language });
  return result;
};

const getComprehensionQuestions = async (testType, language = 'English') => {
  const result = await TestQuestion.aggregate([
    {
      $match: {
        testType,
        section: 'Comprehension',
        language,
      },
    },
    {
      $group: {
        _id: '$paragraphContent',
        questions: { $push: '$$ROOT' },
      },
    },
  ]);
  return result;
};

/**
 * Delete all questions by section
 * @param {String} section
 * @returns {Promise<Object>}
 */
const deleteQuestionsBySection = async (section) => {
  const result = await TestQuestion.deleteMany({ section });
  return result;
};

/**
 * Delete all questions by testType
 * @param {String} testType
 * @returns {Promise<Object>}
 */
const deleteQuestionsByTestType = async (testType) => {
  const result = await TestQuestion.deleteMany({ testType });
  return result;
};

module.exports = {
  createTestQuestion,
  queryTestQuestion,
  getTestQuestionById,
  updateTestQuestionById,
  deleteTestQuestionById,
  getTestQuestions,
  searchTestQuestions,
  getQuestionsByTestType,
  getQuestionsBySection,
  getComprehensionQuestions,
  deleteQuestionsBySection,
  deleteQuestionsByTestType,
};
