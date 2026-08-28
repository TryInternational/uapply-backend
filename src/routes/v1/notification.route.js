const express = require('express');
const notificationController = require('../../controllers/notifications.controller');

const {
  softAuth,
  denySubAgent,
  scopeSubAgentNotificationFeed,
  scopeSubAgentNotificationDoc,
} = require('../../middlewares/subAgentScope');

const router = express.Router();

// Identify the caller for the per-route sub-agent guards below. softAuth never
// rejects, so nothing changes for any other role.
router.use(softAuth);

// Create a notification
router.post('/', denySubAgent, notificationController.createNotification);

// Get notifications for a user
router.get('/:userId', scopeSubAgentNotificationFeed, notificationController.getNotifications);

// Mark a notification as read
router.put('/:notificationId/read', scopeSubAgentNotificationDoc, notificationController.markAsRead);

router.put('/:notificationId/unread', scopeSubAgentNotificationDoc, notificationController.markAsUnread);

module.exports = router;
