/* eslint-disable eqeqeq */
/* eslint-disable array-callback-return */
const httpStatus = require('http-status');
const { pick } = require('lodash');

const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');

const { universitiesService } = require('../services');
// const { fatoorah } = require('../thirdparty');
// const { DateToString } = require('../utils/Common');
// const { PubSub } = require('@google-cloud/pubsub');
// const pubSubClient = new PubSub();

const createUniversity = catchAsync(async (req, res) => {
  const uni = await universitiesService.createUniversity(req.body);

  res.status(httpStatus.CREATED).send(uni);
});

const getUniversities = catchAsync(async (req, res) => {
  // await publishMessage();

  const filter = pick(req.query, ['name', 'status', 'stage', 'level', 'course', 'duration', 'ageGroup', 'optionType']);
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'populate']);
  const result = await universitiesService.queryUniversities(filter, options);
  res.send(result);
});

const getUniversity = catchAsync(async (req, res) => {
  const uni = await universitiesService.getUniversityById(req.params.uniId);

  if (!uni) {
    throw new ApiError(httpStatus.NOT_FOUND, 'University not found');
  }
  res.send(uni);
});

const updateUniversity = catchAsync(async (req, res) => {
  const uni = await universitiesService.updateUniversityById(req.params.uniId, req.body);
  res.send(uni);
});

const deleteUniversity = catchAsync(async (req, res) => {
  await universitiesService.deleteUniversityById(req.params.uniId);
  res.status(httpStatus.NO_CONTENT).send();
});

const searchUniversities = catchAsync(async (req, res) => {
  // const filter = pick(req.query, ['name', 'status', 'stage']);
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'populate']);
  const results = await universitiesService.searchUniversity(req.params.text, options);
  res.status(200).send(results);
});

module.exports = {
  createUniversity,
  getUniversities,
  getUniversity,
  deleteUniversity,
  updateUniversity,
  searchUniversities,
};
