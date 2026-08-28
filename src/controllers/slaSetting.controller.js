const httpStatus = require('http-status');
const catchAsync = require('../utils/catchAsync');
const ApiError = require('../utils/ApiError');
const { slaSettingService } = require('../services');
const { actorOf } = require('../utils/actor');

/**
 * Readable by any signed-in user, because every pipeline surface needs the
 * thresholds to draw a ring; writable by admins only (enforced on the route).
 */
const getSlaSettings = catchAsync(async (req, res) => {
  res.send(await slaSettingService.getSettings());
});

const updateSlaSettings = catchAsync(async (req, res) => {
  try {
    const actor = actorOf(req);
    const saved = await slaSettingService.saveSettings(req.body, actor && actor.id);
    res.send(saved);
  } catch (err) {
    if (err.validation) throw new ApiError(httpStatus.BAD_REQUEST, err.message);
    throw err;
  }
});

module.exports = { getSlaSettings, updateSlaSettings };
