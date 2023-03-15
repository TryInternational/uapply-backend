const httpStatus = require('http-status');
const { pick } = require('lodash');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');
const { disciplineService } = require('../services');

const createDiscipline = catchAsync(async (req, res) => {
  const discipline = await disciplineService.createDiscipline(req.body);
  res.status(httpStatus.CREATED).send(discipline);
});

const getDisciplines = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['name', 'slug']);
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'populate']);
  const result = await disciplineService.queryRoles(filter, options);
  res.send(result);
});

const getDiscipline = catchAsync(async (req, res) => {
  const discipline = await disciplineService.getRoleById(req.params.disciplineId);
  if (!discipline) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Discipline not found');
  }
  res.send(discipline);
});

const updateDiscipline = catchAsync(async (req, res) => {
  const discipline = await disciplineService.updateRoleById(req.params.disciplineId, req.body);
  res.send(discipline);
});

const deleteDiscipline = catchAsync(async (req, res) => {
  await disciplineService.deleteRoleById(req.params.disciplineId);
  res.status(httpStatus.NO_CONTENT).send();
});

module.exports = {
  createDiscipline,
  getDisciplines,
  getDiscipline,
  updateDiscipline,
  deleteDiscipline,
};
