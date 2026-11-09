const httpStatus = require('http-status');
const mongoose = require('mongoose');
const { Reminder, Students } = require('../models');
const ApiError = require('../utils/ApiError');

const createReminder = async (body) => Reminder.create(body);

const queryReminders = async (filter, options) => Reminder.paginate(filter, options);

const getReminderById = async (id) => Reminder.findById(id);

const getRemindersForUser = async (userId, { status } = {}) => {
  const q = { user: userId };
  if (status) q.status = status;
  return Reminder.find(q).sort({ dueDate: 1 }).populate('student', 'firstName lastName phoneNo stage').lean();
};

const updateReminderById = async (id, body) => {
  const reminder = await getReminderById(id);
  if (!reminder) throw new ApiError(httpStatus.NOT_FOUND, 'Reminder not found');
  if (body.status === 'completed' && !reminder.completedAt) {
    body.completedAt = new Date();
  }
  Object.assign(reminder, body);
  await reminder.save();
  return reminder;
};

const deleteReminderById = async (id) => {
  const reminder = await getReminderById(id);
  if (!reminder) throw new ApiError(httpStatus.NOT_FOUND, 'Reminder not found');
  await reminder.remove();
  return reminder;
};

// Counselor "My Desk" data — the user's open reminders bucketed by due date.
const getDeskData = async (userId) => {
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);

  const pending = await Reminder.find({ user: userId, status: { $in: ['pending', 'snoozed'] } })
    .sort({ dueDate: 1 })
    .populate('student', 'firstName lastName phoneNo stage')
    .lean();

  const overdue = pending.filter((r) => r.dueDate && new Date(r.dueDate) < startOfToday);
  const today = pending.filter((r) => r.dueDate && new Date(r.dueDate) >= startOfToday && new Date(r.dueDate) <= endOfToday);
  const upcoming = pending.filter((r) => r.dueDate && new Date(r.dueDate) > endOfToday);

  return {
    overdue,
    today,
    upcoming,
    counts: { overdue: overdue.length, today: today.length, upcoming: upcoming.length },
  };
};

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_LABEL = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "September" / "Sep" / "9" / "09" → 0-based month, or -1. */
const monthIndexOf = (raw) => {
  const s = String(raw || '')
    .trim()
    .toLowerCase();
  if (!s) return -1;
  const n = Number(s);
  if (Number.isInteger(n) && n >= 1 && n <= 12) return n - 1;
  return MONTHS.indexOf(s.slice(0, 3));
};

/**
 * The nav calendar (design: Admin A nav › Calendar): today's appointments,
 * this week's (today + the next six days) and the upcoming intake deadlines.
 *
 * Appointments are the caller's pending reminders. Intake deadlines are worked
 * out from the students' chosen intakes (preference.intakeMonth / intakeYear):
 * one row per intake starting in the next twelve months, with how many of the
 * caller's students (every student, for an admin) are on it and how many have
 * already applied. The CRM keeps no separate deadline records, so the intake's
 * start date is the deadline.
 */
const getCalendar = async (userId, { admin = false } = {}) => {
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  const endOfWeek = new Date(endOfToday);
  endOfWeek.setDate(endOfWeek.getDate() + 6);

  const reminders = await Reminder.find({
    user: userId,
    status: { $in: ['pending', 'snoozed'] },
    dueDate: { $gte: startOfToday, $lte: endOfWeek },
  })
    .sort({ dueDate: 1 })
    .populate('student', 'firstName lastName phoneNo stage')
    .lean();
  const today = reminders.filter((r) => new Date(r.dueDate) <= endOfToday);

  const match = {
    'preference.intakeYear': { $nin: [null, ''] },
    'preference.intakeMonth': { $nin: [null, ''] },
    stage: { $nin: ['Lost', 'Denied', 'PendingReview'] },
  };
  // aggregate() does not cast, so the id must be an ObjectId here
  if (!admin) match['assignedTo.user'] = new mongoose.Types.ObjectId(String(userId));
  const rows = await Students.aggregate([
    { $match: match },
    {
      $group: {
        _id: { y: '$preference.intakeYear', m: '$preference.intakeMonth' },
        total: { $sum: 1 },
        done: { $sum: { $cond: [{ $in: ['$stage', ['Applied', 'Enrolled']] }, 1, 0] } },
      },
    },
  ]);

  const horizon = new Date(startOfToday);
  horizon.setFullYear(horizon.getFullYear() + 1);
  const byIntake = new Map();
  rows.forEach((r) => {
    const mi = monthIndexOf(r._id.m);
    const y = Number(String(r._id.y).trim());
    if (mi < 0 || !Number.isInteger(y)) return;
    const date = new Date(y, mi, 1);
    if (date < startOfToday || date > horizon) return;
    const key = `${y}-${mi}`;
    const prev = byIntake.get(key) || { intake: `${MONTH_LABEL[mi]} ${y}`, date, total: 0, done: 0 };
    prev.total += r.total;
    prev.done += r.done;
    byIntake.set(key, prev);
  });
  const deadlines = [...byIntake.values()]
    .sort((a, b) => a.date - b.date)
    .map((d) => ({ ...d, days: Math.ceil((d.date - startOfToday) / 86400000) }));

  return { today, week: reminders, deadlines };
};

module.exports = {
  createReminder,
  queryReminders,
  getReminderById,
  getRemindersForUser,
  updateReminderById,
  deleteReminderById,
  getDeskData,
  getCalendar,
};
