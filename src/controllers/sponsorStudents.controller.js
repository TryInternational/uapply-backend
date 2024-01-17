const httpStatus = require('http-status');
const { pick } = require('lodash');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');
const { sponsorStudentService } = require('../services');

const createSponsorStudent = catchAsync(async (req, res) => {
  const sponsorStudent = await sponsorStudentService.createSponsorStudent(req.body);
  res.status(httpStatus.CREATED).send(sponsorStudent);
});

const getSponsorStudents = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['name', 'slug']);
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'populate']);
  const result = await sponsorStudentService.querySponsorStudents(filter, options);
  res.send(result);
});

const getSponsorStudent = catchAsync(async (req, res) => {
  const sponsorStudent = await sponsorStudentService.getSponsorStudentById(req.params.sponsorStudentId);
  if (!sponsorStudent) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Student not found');
  }
  res.send(sponsorStudent);
});

const updateSponsorStudent = catchAsync(async (req, res) => {
  const sponsorStudent = await sponsorStudentService.updateSponsorStudentById(req.params.sponsorStudentId, req.body);
  res.send(sponsorStudent);
});

const deleteSponsorStudent = catchAsync(async (req, res) => {
  await sponsorStudentService.deleteSponsorStudentById(req.params.sponsorStudentId);
  res.status(httpStatus.NO_CONTENT).send();
});

module.exports = {
  createSponsorStudent,
  getSponsorStudents,
  getSponsorStudent,
  updateSponsorStudent,
  deleteSponsorStudent,
};
