/* eslint-disable no-return-assign */
/* eslint-disable eqeqeq */
/* eslint-disable array-callback-return */
const httpStatus = require('http-status');
const { pick } = require('lodash');

const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');

const { englishLangSchoolService } = require('../services');

const createSchool = catchAsync(async (req, res) => {
  const school = await englishLangSchoolService.createEnglishLangSchool(req.body);

  res.status(httpStatus.CREATED).send(school);
});

const getSchools = catchAsync(async (req, res) => {
  // await publishMessage();
  const filter = pick(req.query, ['schoolName', 'countryName']);
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'populate']);
  const result = await englishLangSchoolService.queryEnglishLangSchool(filter, options);
  res.send(result);
});

const getSchool = catchAsync(async (req, res) => {
  const school = await englishLangSchoolService.getEnglishLangSchoolById(req.params.schoolId);

  if (!school) {
    throw new ApiError(httpStatus.NOT_FOUND, 'subject not found');
  }
  res.send(school);
});

const updateSchool = catchAsync(async (req, res) => {
  const subject = await englishLangSchoolService.updateEnglishLangSchoolById(req.params.schoolId, req.body);

  res.send(subject);
});

const deleteSchool = catchAsync(async (req, res) => {
  await englishLangSchoolService.deleteEnglishLangSchoolById(req.params.schoolId);
  res.status(httpStatus.NO_CONTENT).send();
});

const searchSchools = catchAsync(async (req, res) => {
  // const filter = pick(req.query, ['name', 'status', 'stage']);
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'populate']);
  const results = await englishLangSchoolService.searchEnglishLangSchool(req.params.text, options);
  res.status(200).send(results);
});

module.exports = {
  createSchool,
  getSchool,
  getSchools,
  deleteSchool,
  updateSchool,
  searchSchools,
};
