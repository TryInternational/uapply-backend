const httpStatus = require('http-status');
const catchAsync = require('../utils/catchAsync');
const ApiError = require('../utils/ApiError');
const { goalService } = require('../services');
const { actorOf } = require('../utils/actor');

const yearOf = (raw) => {
  const y = Number(raw || new Date().getFullYear());
  if (!Number.isInteger(y) || y < 2000 || y > 2100) throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid year');
  return y;
};

/** Any signed-in user may read the goals; only admins may change them (route). */
const getGoals = catchAsync(async (req, res) => {
  res.send(await goalService.getGoals(yearOf(req.params.year)));
});

const updateGoals = catchAsync(async (req, res) => {
  try {
    const actor = actorOf(req);
    res.send(await goalService.saveGoals(yearOf(req.params.year), req.body || {}, actor && actor.id));
  } catch (err) {
    if (err.validation) throw new ApiError(httpStatus.BAD_REQUEST, err.message);
    throw err;
  }
});

module.exports = { getGoals, updateGoals };
