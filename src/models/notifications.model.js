// models/Notification.js
const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    userIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }], // Array of user IDs
    message: { type: String, required: true },
    applicationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Students' },
    createdBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'Users', autopopulate: true },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Students', required: true },
    type: { type: String, enum: ['application', 'student', 'comment', 'system'], default: 'system' }, // Notification type
    readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], // Track which users have read the notification
  },
  { timestamps: true }
);

module.exports = mongoose.model('Notifications', notificationSchema);
