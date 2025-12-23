const notificationService = require('../services/notifications.services');

// Create a notification for multiple users
const createNotification = async (req, res) => {
  try {
    // eslint-disable-next-line prefer-const
    let { userIds, message, type, studentId } = req.body;

    // Deduplicate userIds
    userIds = [...new Set(userIds)];

    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ error: 'userIds must be a non-empty array' });
    }
    const io = req.app.get('io');
    const notification = await notificationService.createNotification(io, userIds, message, type, studentId);

    // Access the io instance from the app

    // Emit the notification to each user's room

    res.status(201).json(notification);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Get notifications for a user
const getNotifications = async (req, res) => {
  try {
    const { userId } = req.params;
    const notifications = await notificationService.getNotifications(userId);
    res.status(200).json(notifications);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Mark a notification as read by a specific user
const markAsRead = async (req, res) => {
  try {
    const { notificationId, userId } = req.body;

    // Validate input
    if (!notificationId || !userId) {
      return res.status(400).json({ error: 'notificationId and userId are required' });
    }

    const notification = await notificationService.markAsRead(notificationId, userId);
    res.status(200).json(notification);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const markAsUnread = async (req, res) => {
  try {
    const { notificationId, userId } = req.body;

    // Validate input
    if (!notificationId || !userId) {
      return res.status(400).json({ error: 'notificationId and userId are required' });
    }

    const notification = await notificationService.markAsUnread(notificationId, userId);
    res.status(200).json(notification);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = { createNotification, getNotifications, markAsRead, markAsUnread };
