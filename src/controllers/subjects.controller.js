/* eslint-disable no-return-assign */
/* eslint-disable eqeqeq */
/* eslint-disable array-callback-return */
const httpStatus = require('http-status');
const { pick } = require('lodash');

const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');

const { subjectsService } = require('../services');
// const { fatoorah } = require('../thirdparty');
// const { DateToString } = require('../utils/Common');
// const { PubSub } = require('@google-cloud/pubsub');
// const pubSubClient = new PubSub();

const createSubject = catchAsync(async (req, res) => {
  const subject = await subjectsService.createSubject(req.body);

  res.status(httpStatus.CREATED).send(subject);
});

const getSubjects = catchAsync(async (req, res) => {
  // await publishMessage();
  const filter = pick(req.query, ['name', 'status', 'stage', 'level', 'course', 'duration', 'ageGroup', 'optionType']);
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'populate']);
  const result = await subjectsService.querySubjects(filter, options);
  res.send(result);
});

const getSubject = catchAsync(async (req, res) => {
  const subject = await subjectsService.getSubjectById(req.params.subjectId);

  if (!subject) {
    throw new ApiError(httpStatus.NOT_FOUND, 'subject not found');
  }
  res.send(subject);
});

const updateSubject = catchAsync(async (req, res) => {
  const subject = await subjectsService.updateSubjectById(req.params.subjectId, req.body);

  res.send(subject);
});

const deleteSubject = catchAsync(async (req, res) => {
  await subjectsService.deleteSubjectById(req.params.subjectId);
  res.status(httpStatus.NO_CONTENT).send();
});

const searchSubjects = catchAsync(async (req, res) => {
  // const filter = pick(req.query, ['name', 'status', 'stage']);
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'populate']);
  const results = await subjectsService.searchSubjects(req.params.text, options);
  res.status(200).send(results);
});

module.exports = {
  createSubject,
  getSubject,
  getSubjects,
  deleteSubject,
  updateSubject,
  searchSubjects,
};
