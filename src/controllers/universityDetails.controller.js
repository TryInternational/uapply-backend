/* eslint-disable eqeqeq */
/* eslint-disable array-callback-return */
const httpStatus = require('http-status');
const { pick } = require('lodash');

const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');

const { universitiesDetailsService } = require('../services');
// const { fatoorah } = require('../thirdparty');
// const { DateToString } = require('../utils/Common');
// const { PubSub } = require('@google-cloud/pubsub');
// const pubSubClient = new PubSub();

const createUniversityDetail = catchAsync(async (req, res) => {
  const uni = await universitiesDetailsService.createUniversitiesDetails(req.body);

  res.status(httpStatus.CREATED).send(uni);
});

const getUniversitiesDetails = catchAsync(async (req, res) => {
  // await publishMessage();

  const filter = pick(req.query, ['name', 'status', 'stage', 'level', 'course', 'duration', 'ageGroup', 'optionType']);
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'populate']);
  const result = await universitiesDetailsService.queryUniversitiesDetails(filter, options);

  res.send(result);
});

const getUniversityDetails = catchAsync(async (req, res) => {
  const uni = await universitiesDetailsService.getUniversitiesDetailsById(req.params.uniId);

  if (!uni) {
    throw new ApiError(httpStatus.NOT_FOUND, 'University not found');
  }
  res.send(uni);
});

const updateUniversityDetail = catchAsync(async (req, res) => {
  const uni = await universitiesDetailsService.updateUniversitiesDetailsById(req.params.uniId, req.body);
  res.send(uni);
});

const deleteUniversityDetail = catchAsync(async (req, res) => {
  await universitiesDetailsService.deleteUniversitiesDetailsById(req.params.uniId);
  res.status(httpStatus.NO_CONTENT).send();
});

const searchUniversitiesDetails = catchAsync(async (req, res) => {
  // const filter = pick(req.query, ['name', 'status', 'stage']);
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'populate']);
  const results = await universitiesDetailsService.searchUniversitiesDetails(req.params.text, options);
  res.status(200).send(results);
});

module.exports = {
  createUniversityDetail,
  getUniversitiesDetails,
  getUniversityDetails,
  deleteUniversityDetail,
  updateUniversityDetail,
  searchUniversitiesDetails,
};
