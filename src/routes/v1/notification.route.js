const express = require('express');
const notificationController = require('../../controllers/notifications.controller');

const router = express.Router();

// Create a notification
router.post('/', notificationController.createNotification);

// Get notifications for a user
router.get('/:userId', notificationController.getNotifications);

// Mark a notification as read
router.put('/:notificationId/read', notificationController.markAsRead);

router.put('/:notificationId/unread', notificationController.markAsUnread);

module.exports = router;
