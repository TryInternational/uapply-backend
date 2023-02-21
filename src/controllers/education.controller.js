const httpStatus = require('http-status');
const { pick } = require('lodash');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');
const { educationService } = require('../services');

const createStudentEducation = catchAsync(async (req, res) => {
  const role = await educationService.createRole(req.body);
  res.status(httpStatus.CREATED).send(role);
});

const getStudentEducations = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['name', 'slug']);
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'populate']);
  const result = await educationService.queryRoles(filter, options);
  res.send(result);
});

const getStudentEducation = catchAsync(async (req, res) => {
  const education = await educationService.getRoleById(req.params.roleId);
  if (!education) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Role not found');
  }
  res.send(education);
});

const updateStudentEducation = catchAsync(async (req, res) => {
  const education = await educationService.updateRoleById(req.params.educationId, req.body);
  res.send(education);
});

const deleteStudentEducation = catchAsync(async (req, res) => {
  await educationService.deleteRoleById(req.params.educationId);
  res.status(httpStatus.NO_CONTENT).send();
});

module.exports = {
  createStudentEducation,
  getStudentEducations,
  getStudentEducation,
  updateStudentEducation,
  deleteStudentEducation,
};
