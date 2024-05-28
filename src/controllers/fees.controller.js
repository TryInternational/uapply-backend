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
  if (req.query.user) {
    const salesPersons = Array.isArray(req.query.user) ? req.query.user : req.query.user.split(',');

    filter['tag.salesPerson'] = { $in: salesPersons };
  }
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
const searchFees = catchAsync(async (req, res) => {
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'populate', 'qualified', { searchString: req.params.text }]);
  const results = await feesService.searchFees(req.params.text, options);
  res.status(200).send(results);
});

module.exports = {
  getFeesById,
  getFees,
  updateFees,
  searchFees,
  deleteFees,
  createFees,
  getAmountPermonth,
};
