const httpStatus = require('http-status');
const { pick } = require('lodash');
const { DateTime } = require('luxon');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');
const { appliedStudentService } = require('../services');
const { convertASTToUTC } = require('../utils/Common');

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

const getAppliedPerCounselor = catchAsync(async (req, res) => {
  const astTime = DateTime.fromISO(new Date(req.query.startDate).toISOString(), {
    zone: 'Asia/Riyadh',
  }).startOf('day');

  const data = await appliedStudentService.getUserNumberSums(
    convertASTToUTC(astTime, true).toString(),
    convertASTToUTC(
      DateTime.fromISO(new Date(req.query.endDate).toISOString(), {
        zone: 'Asia/Riyadh',
      }).endOf('day'),
      true
    ).toString()
  );
  res.send(data);
});

const deleteAppliedStudent = catchAsync(async (req, res) => {
  await appliedStudentService.deleteFeesById(req.params.id);
  res.status(httpStatus.NO_CONTENT).send();
});

const getStudentCountByDegree = catchAsync(async (req, res) => {
  const filters = pick(req.query, ['startDate', 'endDate']);

  // Convert dates if provided
  if (filters.startDate) {
    filters.startDate = DateTime.fromISO(filters.startDate).toJSDate();
  }
  if (filters.endDate) {
    filters.endDate = DateTime.fromISO(filters.endDate).toJSDate();
  }

  const result = await appliedStudentService.getStudentCountByDegree(filters);
  res.send({
    success: true,
    data: result,
    totalDegrees: result.length,
  });
});
module.exports = {
  getAppliedStudent,
  getAppliedStudentById,
  updateAppliedStudent,
  deleteAppliedStudent,
  createAppliedStudent,
  getAmountPermonth,
  getAppliedPerCounselor,
  getStudentCountByDegree,
};
