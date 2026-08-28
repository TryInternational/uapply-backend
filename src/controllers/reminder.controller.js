const httpStatus = require('http-status');
const pick = require('../utils/pick');
const catchAsync = require('../utils/catchAsync');
const { remindersService, activitiesService } = require('../services');

const createReminder = catchAsync(async (req, res) => {
  const reminder = await remindersService.createReminder(req.body);

  // Timeline: record the reminder (non-fatal) when it's tied to a student.
  if (reminder.student) {
    await activitiesService.logActivity({
      student: reminder.student,
      type: 'reminder',
      text: `Reminder set: ${reminder.title}`,
      actorId: reminder.createdBy || reminder.user,
      meta: { reminderId: reminder.id, dueDate: reminder.dueDate },
    });
  }

  res.status(httpStatus.CREATED).send(reminder);
});

// GET /reminders?user=&status=  — a counselor's reminders.
const getReminders = catchAsync(async (req, res) => {
  const { user, status } = pick(req.query, ['user', 'status']);
  const reminders = await remindersService.getRemindersForUser(user, { status });
  res.send(reminders);
});

// GET /reminders/desk?user=  — bucketed data for the counselor "My Desk".
const getDesk = catchAsync(async (req, res) => {
  const { user } = pick(req.query, ['user']);
  const desk = await remindersService.getDeskData(user);
  res.send(desk);
});

const updateReminder = catchAsync(async (req, res) => {
  const reminder = await remindersService.updateReminderById(req.params.reminderId, req.body);
  res.send(reminder);
});

const deleteReminder = catchAsync(async (req, res) => {
  await remindersService.deleteReminderById(req.params.reminderId);
  res.status(httpStatus.NO_CONTENT).send();
});

module.exports = {
  createReminder,
  getReminders,
  getDesk,
  updateReminder,
  deleteReminder,
};
