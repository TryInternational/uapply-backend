const httpStatus = require('http-status');
const { pick } = require('lodash');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');
const { coursesService } = require('../services');
// const { fatoorah } = require('../thirdparty');
// const { DateToString } = require('../utils/Common');
// const { PubSub } = require('@google-cloud/pubsub');
// const pubSubClient = new PubSub();

const createCourse = catchAsync(async (req, res) => {
  const course = await coursesService.createCourse(req.body);

  res.status(httpStatus.CREATED).send(course);
});

const getCourses = catchAsync(async (req, res) => {
  // await publishMessage();
  let locations;
  let attendanceTypes;
  let courseLevel;
  let institutionSlug;
  let intakeMonths;
  let courseDurationValues;
  let subjects;
  let placementAvailable;
  if (req.query.city) {
    locations = { $elemMatch: { key: req.query.country, value: { $in: req.query.city.split(',') } } };
  } else {
    locations = { $elemMatch: { key: req.query.country } };
  }
  if (req.query.attendanceTypes) {
    attendanceTypes = {
      $in: req.query.attendanceTypes.split(','),
    };
  }
  if (req.query.courseLevel) {
    courseLevel = req.query.courseLevel;
  }
  if (req.query.institution) {
    institutionSlug = {
      $in: req.query.institution.split(','),
    };
  }
  if (req.query.courseDurationValues) {
    courseDurationValues = {
      $in: parseInt(req.query.courseDurationValues.split(','), 10),
    };
  }
  if (req.query.intakeMonths) {
    intakeMonths = {
      $in: req.query.intakeMonths.split(','),
    };
  }
  if (req.query.subjects) {
    subjects = {
      $in: req.query.subjects.split(','),
    };
  }
  if (req.query.placementAvailable) {
    placementAvailable = req.query.placementAvailable;
  }
  const filter = {
    courseLevel,
    institutionSlug,
    locations,
    attendanceTypes,
    intakeMonths,
    courseDurationValues,
    subjects,
    placementAvailable,
  };
  Object.keys(filter).forEach((key) => (filter[key] === undefined ? delete filter[key] : {}));
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'populate']);
  console.log(filter);
  const result = await coursesService.queryCourses(filter, options);
  res.send(result);
});

const getCourse = catchAsync(async (req, res) => {
  const course = await coursesService.getCourseById(req.params.courseId);
  if (!course) {
    throw new ApiError(httpStatus.NOT_FOUND, 'course not found');
  }
  res.send(course);
});

const updateCourse = catchAsync(async (req, res) => {
  const course = await coursesService.updateCourseById(req.params.courseId, req.body);

  res.send(course);
});

const deleteCourse = catchAsync(async (req, res) => {
  await coursesService.deleteCourseById(req.params.courseId);
  res.status(httpStatus.NO_CONTENT).send();
});

const searchCourses = catchAsync(async (req, res) => {
  // const filter = pick(req.query, ['name', 'status', 'stage']);
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'populate']);
  const results = await coursesService.searchCourse(req.params.text, options);
  res.status(200).send(results);
});

module.exports = {
  createCourse,
  getCourse,
  getCourses,
  deleteCourse,
  updateCourse,
  searchCourses,
};
