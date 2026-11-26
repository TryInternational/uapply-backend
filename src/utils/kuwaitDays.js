const { DateTime } = require('luxon');

const KUWAIT_TZ = 'Asia/Kuwait';

const asDate = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** Are both of these dates? A range needs the two of them. */
const areDates = (startDate, endDate) => !!asDate(startDate) && !!asDate(endDate);

/**
 * The Kuwait days from the day `startDate` falls on to the day `endDate`
 * falls on, as the instants the first begins and the last ends.
 *
 * For anything stored as a moment (createdAt and the like). The dashboards
 * send the range as instants already, and a plain day ("2026-03-01") works as
 * well: either way it is the Kuwait day that instant is in.
 *
 * @param {string|Date} startDate
 * @param {string|Date} endDate
 * @returns {{from: Date, to: Date}|null} null when either is missing or is not a date
 */
const kuwaitDayRange = (startDate, endDate) => {
  const start = asDate(startDate);
  const end = asDate(endDate);
  if (!start || !end) return null;
  return {
    from: DateTime.fromJSDate(start, { zone: KUWAIT_TZ }).startOf('day').toJSDate(),
    to: DateTime.fromJSDate(end, { zone: KUWAIT_TZ }).endOf('day').toJSDate(),
  };
};

module.exports = { KUWAIT_TZ, areDates, kuwaitDayRange };
