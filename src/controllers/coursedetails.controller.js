/* eslint-disable eqeqeq */
/* eslint-disable array-callback-return */
const httpStatus = require('http-status');
const { pick } = require('lodash');

const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');

const { courseDetailsService } = require('../services');
// const { fatoorah } = require('../thirdparty');
// const { DateToString } = require('../utils/Common');
// const { PubSub } = require('@google-cloud/pubsub');
// const pubSubClient = new PubSub();

const createCourseDetail = catchAsync(async (req, res) => {
  const course = await courseDetailsService.createCourseDetails(req.body);

  res.status(httpStatus.CREATED).send(course);
});

const getCourseDetails = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['name', 'status', 'stage', 'level', 'course', 'duration', 'ageGroup', 'optionType']);
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'populate']);
  const result = await courseDetailsService.queryCourseDetails(filter, options);
  res.send(result);
});
const getCourseDetailsByRef = catchAsync(async (req, res) => {
  const result = await courseDetailsService.getCourseDetailsByRef(req.params.courseRefId);
  res.send(result);
});

const getCourseDetailsByInstitute = catchAsync(async (req, res) => {
  const result = await courseDetailsService.getCourseDetailsByUniversity(req.params.institute);
  res.send(result);
});

const getCourseDetail = catchAsync(async (req, res) => {
  const course = await courseDetailsService.getCourseDetailsById(req.params.courseId);

  if (!course) {
    throw new ApiError(httpStatus.NOT_FOUND, 'course not found');
  }
  res.send(course);
});

const updateCourseDetail = catchAsync(async (req, res) => {
  const course = await courseDetailsService.updateCourseDetailsById(req.params.courseId, req.body);
  res.send(course);
});

const deleteCourseDetail = catchAsync(async (req, res) => {
  await courseDetailsService.deleteCourseDetailsById(req.params.courseId);
  res.status(httpStatus.NO_CONTENT).send();
});

const searchCoursesDetail = catchAsync(async (req, res) => {
  // const filter = pick(req.query, ['name', 'status', 'stage']);
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'populate']);
  const results = await courseDetailsService.searchCourseDetails(req.params.text, options);
  res.status(200).send(results);
});

module.exports = {
  createCourseDetail,
  getCourseDetails,
  getCourseDetail,
  deleteCourseDetail,
  updateCourseDetail,
  searchCoursesDetail,
  getCourseDetailsByRef,
  getCourseDetailsByInstitute,
};
