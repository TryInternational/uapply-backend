/* eslint-disable no-return-assign */
/* eslint-disable eqeqeq */
/* eslint-disable array-callback-return */
const httpStatus = require('http-status');
const { pick } = require('lodash');

const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');

const { courseLevelService } = require('../services');
// const { fatoorah } = require('../thirdparty');
// const { DateToString } = require('../utils/Common');
// const { PubSub } = require('@google-cloud/pubsub');
// const pubSubClient = new PubSub();

const createCourseLevel = catchAsync(async (req, res) => {
  const courseLevel = await courseLevelService.createCourseLevel(req.body);

  res.status(httpStatus.CREATED).send(courseLevel);
});

const getCourseLevels = catchAsync(async (req, res) => {
  // await publishMessage();
  const filter = pick(req.query);
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'populate']);
  const result = await courseLevelService.queryCourseLevels(filter, options);
  res.send(result);
});

const getCourseLevel = catchAsync(async (req, res) => {
  const courseLevel = await courseLevelService.getCourseLevelById(req.params.courseLevelId);

  if (!courseLevel) {
    throw new ApiError(httpStatus.NOT_FOUND, 'course level not found');
  }
  res.send(courseLevel);
});

const updateCourseLevel = catchAsync(async (req, res) => {
  const courseLevel = await courseLevelService.updateCourseLevelById(req.params.courseLevelId, req.body);

  res.send(courseLevel);
});

const deleteCourseLevel = catchAsync(async (req, res) => {
  await courseLevelService.deleteCourseLevelById(req.params.courseLevelId);
  res.status(httpStatus.NO_CONTENT).send();
});

const searchCourseLevels = catchAsync(async (req, res) => {
  // const filter = pick(req.query, ['name', 'status', 'stage']);
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'populate']);
  const results = await courseLevelService.searchCourseLevel(req.params.text, options);
  res.status(200).send(results);
});

module.exports = {
  createCourseLevel,
  getCourseLevels,
  getCourseLevel,
  updateCourseLevel,
  deleteCourseLevel,
  searchCourseLevels,
};
