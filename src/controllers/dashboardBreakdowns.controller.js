const catchAsync = require('../utils/catchAsync');
const { getDashboardBreakdowns } = require('../services/dashboardBreakdowns.service');

/**
 * GET /students/dashboard-breakdowns?startDate=&endDate=
 * The admin dashboard Stats tab's per-person and per-topic breakdowns
 * (see services/dashboardBreakdowns.service.js). Same range semantics as
 * /students/student-dashboard-data; no range = all time.
 */
const getBreakdowns = catchAsync(async (req, res) => {
  const { startDate, endDate, intake } = req.query;
  res.send(await getDashboardBreakdowns({ startDate, endDate, intake }));
});

module.exports = { getBreakdowns };
