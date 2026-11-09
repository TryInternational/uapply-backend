const express = require('express');
const reminderController = require('../../controllers/reminder.controller');
const { requireAuth, denySubAgent } = require('../../middlewares/subAgentScope');

const router = express.Router();

// Counselor "My Desk" — bucketed reminders (overdue / today / upcoming).
router.get('/desk', reminderController.getDesk);

// Nav calendar — the caller's own appointments + intake deadlines.
router.get('/calendar', requireAuth, denySubAgent, reminderController.getCalendar);

router.route('/').post(reminderController.createReminder).get(reminderController.getReminders);

router.route('/:reminderId').patch(reminderController.updateReminder).delete(reminderController.deleteReminder);

module.exports = router;
