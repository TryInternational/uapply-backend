const httpStatus = require('http-status');
const { pick } = require('lodash');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');
const { appliedStudentService } = require('../services');

const createAppliedStudent = catchAsync(async (req, res) => {
  const fees = await appliedStudentService.createAppliedStudent(req.body);
  res.status(httpStatus.CREATED).send(fees);
});

const getAppliedStudent = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['name', 'slug', 'feeType']);
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'populate']);
  const result = await appliedStudentService.queryFees(filter, options);
  res.send(result);
});

const getAppliedStudentById = catchAsync(async (req, res) => {
  const document = await appliedStudentService.getAppliedStudentById(req.params.documentId);
  if (!document) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Document not found');
  }
  res.send(document);
});

const updateAppliedStudent = catchAsync(async (req, res) => {
  const std = await appliedStudentService.updateAppliedStudentById(req.params.id, req.body);
  res.send(std);
});

const getAmountPermonth = catchAsync(async (req, res) => {
  const data = await appliedStudentService.getAmounts();
  res.send(data);
});

const deleteAppliedStudent = catchAsync(async (req, res) => {
  await appliedStudentService.deleteFeesById(req.params.id);
  res.status(httpStatus.NO_CONTENT).send();
});

module.exports = {
  getAppliedStudent,
  getAppliedStudentById,
  updateAppliedStudent,
  deleteAppliedStudent,
  createAppliedStudent,
  getAmountPermonth,
};
