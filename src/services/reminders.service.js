const httpStatus = require('http-status');
const { Reminder } = require('../models');
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
  const today = pending.filter(
    (r) => r.dueDate && new Date(r.dueDate) >= startOfToday && new Date(r.dueDate) <= endOfToday
  );
  const upcoming = pending.filter((r) => r.dueDate && new Date(r.dueDate) > endOfToday);

  return {
    overdue,
    today,
    upcoming,
    counts: { overdue: overdue.length, today: today.length, upcoming: upcoming.length },
  };
};

module.exports = {
  createReminder,
  queryReminders,
  getReminderById,
  getRemindersForUser,
  updateReminderById,
  deleteReminderById,
  getDeskData,
};
