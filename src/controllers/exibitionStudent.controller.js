const httpStatus = require('http-status');
const { pick } = require('lodash');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');
const { exibitionStudentService } = require('../services');

const createExibitionStudent = catchAsync(async (req, res) => {
  const document = await exibitionStudentService.createExibitionStudent(req.body);
  res.status(httpStatus.CREATED).send(document);
});

const getExibitionStudents = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['name', 'slug', 'status']);
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'populate']);
  const result = await exibitionStudentService.queryExibitionStudent(filter, options);
  res.send(result);
});

const getExibitionStudent = catchAsync(async (req, res) => {
  const document = await exibitionStudentService.getDocumetnsById(req.params.documentId);
  if (!document) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Document not found');
  }
  res.send(document);
});

const updateExibitionStudent = catchAsync(async (req, res) => {
  const std = await exibitionStudentService.updateExibitionStudentsById(req.params.id, req.body);
  res.send(std);
});

const deleteExibitionStudent = catchAsync(async (req, res) => {
  await exibitionStudentService.deleteExibitionStudentById(req.params.id);
  res.status(httpStatus.NO_CONTENT).send();
});

module.exports = {
  getExibitionStudent,
  getExibitionStudents,
  updateExibitionStudent,
  deleteExibitionStudent,
  createExibitionStudent,
};
