const httpStatus = require('http-status');
const { pick } = require('lodash');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');
const { feesService } = require('../services');

const createFees = catchAsync(async (req, res) => {
  const fees = await feesService.createFees(req.body);
  res.status(httpStatus.CREATED).send(fees);
});

const getFees = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['name', 'slug', 'feeType']);
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'populate']);
  const result = await feesService.queryFees(filter, options);
  res.send(result);
});

const getFeesById = catchAsync(async (req, res) => {
  const document = await feesService.getFeesById(req.params.documentId);
  if (!document) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Document not found');
  }
  res.send(document);
});

const updateFees = catchAsync(async (req, res) => {
  const std = await feesService.updateFeesById(req.params.id, req.body);
  res.send(std);
});

const getAmountPermonth = catchAsync(async (req, res) => {
  const data = await feesService.getAmounts();
  res.send(data);
});

const deleteFees = catchAsync(async (req, res) => {
  await feesService.deleteFeesById(req.params.id);
  res.status(httpStatus.NO_CONTENT).send();
});

module.exports = {
  getFeesById,
  getFees,
  updateFees,
  deleteFees,
  createFees,
  getAmountPermonth,
};
