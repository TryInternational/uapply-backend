const httpStatus = require('http-status');
const { pick } = require('lodash');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');
const { workExperience } = require('../services');

const createWorkExperience = catchAsync(async (req, res) => {
  const workExp = await workExperience.createWorkExperience(req.body);
  res.status(httpStatus.CREATED).send(workExp);
});

const getWorkExperiences = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['name', 'slug']);
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'populate']);
  const result = await workExperience.queryWorkExperience(filter, options);
  res.send(result);
});

const getWorkExperience = catchAsync(async (req, res) => {
  const workExp = await workExperience.getWorkExperienceById(req.params.workExpId);
  if (!workExp) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Role not found');
  }
  res.send(workExp);
});

const updateWorkExperience = catchAsync(async (req, res) => {
  const workExp = await workExperience.updateWorkExperienceById(req.params.workExpId, req.body);
  res.send(workExp);
});

const deleteWorkExperience = catchAsync(async (req, res) => {
  await workExperience.deleteWorkExperienceById(req.params.workExpId);
  res.status(httpStatus.NO_CONTENT).send();
});

module.exports = {
  createWorkExperience,
  getWorkExperience,
  getWorkExperiences,
  updateWorkExperience,
  deleteWorkExperience,
};
