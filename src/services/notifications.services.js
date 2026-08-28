const { Notifications } = require('../models');

// Create a new notification for multiple users
const createNotification = async (io, userIds, message, type, studentId, applicationId, createdBy) => {
  try {
    console.log(createdBy);
    const notification = await Notifications.create({
      userIds,
      message,
      applicationId,
      createdBy,
      studentId,
      type,
    });
    console.log(notification);
    await notification.save();
    userIds = [...new Set(userIds)];

    userIds.forEach((userId) => {
      console.log(`Emitting notification to user ${userId}:`, message); // Debugging
      io.to(userId.toString()).emit('notification', notification); // Changed event name to 'notification'
    });
    return notification;
  } catch (error) {
    console.log(error);
  }
};

// Create a WhatsApp notification (assignment / new message / note mention) and
// push it to each user's socket room. Reuses the shared 'notification' event so
// the existing toast + bell handle it. studentId/conversationId are optional.
const createWhatsappNotification = async (io, userIds, message, { studentId, conversationId, createdBy } = {}) => {
  const ids = [...new Set((userIds || []).map((u) => u && u.toString()).filter(Boolean))];
  if (!ids.length) return null;
  try {
    const notification = await Notifications.create({
      userIds: ids,
      message,
      studentId,
      conversationId,
      createdBy,
      type: 'whatsapp',
    });
    if (io) ids.forEach((userId) => io.to(userId).emit('notification', notification));
    return notification;
  } catch (error) {
    return null;
  }
};

// Get notifications for a specific user
const getNotifications = async (userId) => {
  const notifications = await Notifications.find({ userIds: userId }).sort({ createdAt: -1 });
  return notifications;
};

// Mark a notification as read by a specific user
const markAsRead = async (notificationId, userId) => {
  const notification = await Notifications.findById(notificationId);

  if (!notification) {
    throw new Error('Notification not found');
  }

  // Add the user to the readBy array if not already present
  if (!notification.readBy.includes(userId)) {
    notification.readBy.push(userId);
    await notification.save();
  }

  return notification;
};
// Mark a notification as unread by a specific user
const markAsUnread = async (notificationId, userId) => {
  const notification = await Notifications.findById(notificationId);

  if (!notification) {
    throw new Error('Notification not found');
  }

  // Remove the user from the readBy array if present
  notification.readBy = notification.readBy.filter((id) => id.toString() !== userId.toString());
  await notification.save();

  return notification;
};

module.exports = { createNotification, createWhatsappNotification, getNotifications, markAsRead, markAsUnread };
