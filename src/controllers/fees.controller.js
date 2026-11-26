const httpStatus = require('http-status');
const { pick } = require('lodash');
const { DateTime } = require('luxon');
const { convertASTToUTC } = require('../utils/Common');
const { areDates } = require('../utils/kuwaitDays');

const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');
const { feesService } = require('../services');
const Students = require('../models/students.model');

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
  // Only fees tied to a student record (the Fees page's "Linked to a student").
  if (req.query.linked === 'true' || req.query.linked === true) {
    filter.student = { $exists: true, $ne: null };
  }
  // Everything one student paid for: the linked id, or — for rows recorded
  // before the link existed — a tag.studentName that matches their full name.
  if (req.query.student) {
    const or = [{ student: req.query.student }, { 'tag.student': req.query.student }];
    const stu = await Students.findById(req.query.student).select('firstName middleName lastName').lean();
    if (stu) {
      const esc = (x) =>
        String(x || '')
          .trim()
          .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const parts = [stu.firstName, stu.middleName, stu.lastName].map(esc).filter(Boolean);
      if (parts.length) {
        const name = { $regex: `^${parts.join('\\s+')}$`, $options: 'i' };
        or.push({ 'tag.fullName': name }, { 'tag.studentName': name });
      }
    }
    filter.$or = or;
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
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'populate', 'feeType', { searchString: req.params.text }]);
  const results = await feesService.searchFees(req.params.text, options);
  res.status(200).send(results);
});

const getSalesData = catchAsync(async (req, res) => {
  try {
    const { feeType, startDate, endDate } = req.query;

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

    const result = await feesService.getSales(feeType, groupByFields, startDate, endDate);

    res.json(result);
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
  // Asked for before the dates are read: reading a date that is missing or is
  // not one threw, so the check that used to follow was never reached and the
  // caller got a 500.
  if (!areDates(req.query.startDate, req.query.endDate)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'startDate and endDate are required, and must be dates');
  }
  const startDate = DateTime.fromISO(new Date(req.query.startDate).toISOString(), {
    zone: 'Asia/Riyadh',
  }).startOf('day');
  const endDate = DateTime.fromISO(new Date(req.query.endDate).toISOString(), {
    zone: 'Asia/Riyadh',
  }).endOf('day');

  const sd = convertASTToUTC(startDate, true).toString();
  const ed = convertASTToUTC(endDate, true).toString();

  const data = await feesService.getDashboardData({ startDate: sd, endDate: ed });
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
