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

const getSalesData = catchAsync(async (req, res) => {
  try {
    const { feeType, startDate, endDate } = req.query;

    // Validate startDate and endDate
    if (!startDate || !endDate) {
      return res.status(400).send('startDate and endDate are required');
    }

    let groupByFields = [];

    if (feeType === 'office-fees') {
      groupByFields = ['tag.salesPerson'];
    } else if (feeType === 'ielts-booking') {
      groupByFields = ['tag.incharge'];
    } else if (feeType === 'student-visa') {
      groupByFields = ['tag.incharge', 'tag.checkedBy'];
    } else if (feeType === 'english-self-funded') {
      groupByFields = ['tag.accountManager', 'tag.operation', 'tag.salesPerson'];
    } else {
      return res.status(400).send('Invalid feeType');
    }

    const leaderboard = await feesService.getSales(feeType, groupByFields, startDate, endDate);
    res.json(leaderboard);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

const topSchools = catchAsync(async (req, res) => {
  const data = await feesService.getTopSchools({
    ...req.query,
  });
  res.send(data);
});

const topTypes = catchAsync(async (req, res) => {
  const data = await feesService.getTopTypes({
    ...req.query,
  });
  res.send(data);
});

const topTests = catchAsync(async (req, res) => {
  const data = await feesService.getTopTests({
    ...req.query,
  });
  res.send(data);
});

const topCities = catchAsync(async (req, res) => {
  const data = await feesService.getTopCities({
    ...req.query,
  });
  res.send(data);
});

const getDashboardData = catchAsync(async (req, res) => {
  const { startDate, endDate } = req.query;

  // Validate startDate and endDate
  if (!startDate || !endDate) {
    return res.status(400).send('startDate and endDate are required');
  }

  const data = await feesService.getDashboardData({
    startDate,
    endDate,
  });
  res.send(data);
});

module.exports = {
  getFeesById,
  getSalesData,
  getFees,
  updateFees,
  searchFees,
  deleteFees,
  createFees,
  getAmountPermonth,
  topCities,
  topSchools,
  topTypes,
  topTests,
  getDashboardData,
};
