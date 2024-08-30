const httpStatus = require('http-status');
const { pick } = require('lodash');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');
const { ambassadorsService } = require('../services');

const createAmbassador = catchAsync(async (req, res) => {
  const ambassador = await ambassadorsService.createAmbassador(req.body);
  res.status(httpStatus.CREATED).send(ambassador);
});

const getAmbassadors = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['name', 'slug']);
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'populate']);
  const result = await ambassadorsService.queryAmbassadors(filter, options);
  res.send(result);
});

const getAmbassador = catchAsync(async (req, res) => {
  const ambassador = await ambassadorsService.getAmbassadorById(req.params.disciplineId);
  if (!ambassador) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Ambassador not found');
  }
  res.send(ambassador);
});

const updateAmbassador = catchAsync(async (req, res) => {
  const discipline = await ambassadorsService.updateAmbassadorById(req.params.ambassadorId, req.body);
  res.send(discipline);
});

const deleteAmbassador = catchAsync(async (req, res) => {
  await ambassadorsService.deleteRoleById(req.params.ambassadorId);
  res.status(httpStatus.NO_CONTENT).send();
});

module.exports = {
  createAmbassador,
  getAmbassadors,
  getAmbassador,
  updateAmbassador,
  deleteAmbassador,
};
