// models/Notification.js
const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    userIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }], // Array of user IDs
    message: { type: String, required: true },
    applicationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Students' },
    createdBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'Users', autopopulate: true },
    // Optional: WhatsApp notifications may not have a linked student (unknown contact).
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Students' },
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'WhatsappConversation' },
    type: { type: String, enum: ['application', 'student', 'comment', 'system', 'whatsapp'], default: 'system' }, // Notification type
    readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], // Track which users have read the notification
  },
  { timestamps: true }
);

// Performance index — the notification bell polls find({ userIds }).sort({ createdAt: -1 }).
notificationSchema.index({ userIds: 1, createdAt: -1 });

module.exports = mongoose.model('Notifications', notificationSchema);
