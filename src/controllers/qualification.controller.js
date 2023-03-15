const httpStatus = require('http-status');
const { pick } = require('lodash');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');
const { qualificationService } = require('../services');

const createQualification = catchAsync(async (req, res) => {
  const qualification = await qualificationService.createQualification(req.body);
  res.status(httpStatus.CREATED).send(qualification);
});

const getQualifications = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['name', 'slug']);
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'populate']);
  const result = await qualificationService.queryQualifications(filter, options);
  res.send(result);
});

const getQualification = catchAsync(async (req, res) => {
  const qualification = await qualificationService.getQualificationById(req.params.qualificationId);
  if (!qualification) {
    throw new ApiError(httpStatus.NOT_FOUND, 'qualification not found');
  }
  res.send(qualification);
});

const updateQualification = catchAsync(async (req, res) => {
  const qualification = await qualificationService.updateQualificationById(req.params.qualificationId, req.body);
  res.send(qualification);
});

const deleteQualification = catchAsync(async (req, res) => {
  await qualificationService.deleteQualificationById(req.params.qualificationId);
  res.status(httpStatus.NO_CONTENT).send();
});

module.exports = {
  createQualification,
  getQualifications,
  getQualification,
  updateQualification,
  deleteQualification,
};
