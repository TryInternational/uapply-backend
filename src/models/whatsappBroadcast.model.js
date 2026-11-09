const mongoose = require('mongoose');
const { toJSON, paginate } = require('./plugins');

/**
 * A template broadcast to many students. Each recipient becomes an ordinary
 * outbound WhatsappMessage (tagged with `broadcast`) in that contact's
 * conversation, so delivery receipts flow through the normal status webhook and
 * the thread shows what was sent. `counters` is re-derived from those messages.
 */
const recipientSchema = mongoose.Schema(
  {
    student: { type: mongoose.SchemaTypes.ObjectId, ref: 'Students' },
    phone: { type: String },
    name: { type: String },
    conversation: { type: mongoose.SchemaTypes.ObjectId, ref: 'WhatsappConversation' },
    message: { type: mongoose.SchemaTypes.ObjectId, ref: 'WhatsappMessage' },
    status: { type: String, enum: ['queued', 'sent', 'delivered', 'read', 'failed'], default: 'queued' },
    error: { code: { type: String }, title: { type: String } },
  },
  { _id: false }
);

const whatsappBroadcastSchema = mongoose.Schema(
  {
    templateName: { type: String, required: true },
    language: { type: String, required: true },
    defaultComponents: { type: Array, default: [] },
    audience: { type: Object, default: {} },
    audienceLabel: { type: String },
    recipientCount: { type: Number, default: 0 },
    recipients: [recipientSchema],
    status: { type: String, enum: ['queued', 'sending', 'completed', 'failed'], default: 'queued', index: true },
    counters: {
      queued: { type: Number, default: 0 },
      sent: { type: Number, default: 0 },
      delivered: { type: Number, default: 0 },
      read: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
    },
    createdBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', index: true },
    startedAt: { type: Date },
    completedAt: { type: Date },
    lastError: { type: String },
  },
  { timestamps: true }
);

whatsappBroadcastSchema.plugin(toJSON);
whatsappBroadcastSchema.plugin(paginate);

module.exports = mongoose.model('WhatsappBroadcast', whatsappBroadcastSchema);
