const express = require('express');
const reminderController = require('../../controllers/reminder.controller');

const router = express.Router();

// Counselor "My Desk" — bucketed reminders (overdue / today / upcoming).
router.get('/desk', reminderController.getDesk);

router
  .route('/')
  .post(reminderController.createReminder)
  .get(reminderController.getReminders);

router
  .route('/:reminderId')
  .patch(reminderController.updateReminder)
  .delete(reminderController.deleteReminder);

module.exports = router;
