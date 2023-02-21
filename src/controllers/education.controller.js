const httpStatus = require('http-status');
const { pick } = require('lodash');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');
const { educationService } = require('../services');

const createStudentEducation = catchAsync(async (req, res) => {
  const education = await educationService.createStudentEducation(req.body);
  res.status(httpStatus.CREATED).send(education);
});

const getStudentEducations = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['name', 'slug']);
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'populate']);
  const result = await educationService.queryStudentEducation(filter, options);
  res.send(result);
});

const getStudentEducation = catchAsync(async (req, res) => {
  const education = await educationService.getStudentEducationById(req.params.educationId);
  if (!education) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Role not found');
  }
  res.send(education);
});

const updateStudentEducation = catchAsync(async (req, res) => {
  const education = await educationService.updateStudentEducationById(req.params.educationId, req.body);
  res.send(education);
});

const deleteStudentEducation = catchAsync(async (req, res) => {
  await educationService.deleteStudentEducationById(req.params.educationId);
  res.status(httpStatus.NO_CONTENT).send();
});

module.exports = {
  createStudentEducation,
  getStudentEducations,
  getStudentEducation,
  updateStudentEducation,
  deleteStudentEducation,
};
