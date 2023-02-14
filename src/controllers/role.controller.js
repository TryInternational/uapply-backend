const httpStatus = require('http-status');
const { pick } = require('lodash');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');
const { rolesService } = require('../services');

const createRole = catchAsync(async (req, res) => {
  const role = await rolesService.createRole(req.body);
  res.status(httpStatus.CREATED).send(role);
});

const getRoles = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['name', 'slug']);
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'populate']);
  const result = await rolesService.queryRoles(filter, options);
  res.send(result);
});

const getRole = catchAsync(async (req, res) => {
  const role = await rolesService.getRoleById(req.params.roleId);
  if (!role) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Role not found');
  }
  res.send(role);
});

const updateRole = catchAsync(async (req, res) => {
  const role = await rolesService.updateRoleById(req.params.roleId, req.body);
  res.send(role);
});

const deleteRole = catchAsync(async (req, res) => {
  await rolesService.deleteRoleById(req.params.roleId);
  res.status(httpStatus.NO_CONTENT).send();
});

module.exports = {
  createRole,
  getRoles,
  getRole,
  updateRole,
  deleteRole,
};
