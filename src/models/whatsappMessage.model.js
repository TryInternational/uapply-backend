const mongoose = require('mongoose');
const { toJSON, paginate } = require('./plugins');

/**
 * A single WhatsApp message. `waMessageId` is Meta's wamid (used to reconcile
 * delivery-status webhooks); `clientRef` is echoed back to the frontend so an
 * optimistic outbound bubble can be reconciled.
 */
const whatsappMessageSchema = mongoose.Schema(
  {
    conversation: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'WhatsappConversation',
      required: true,
      index: true,
    },
    waMessageId: { type: String, index: true },
    clientRef: { type: String },
    direction: { type: String, enum: ['inbound', 'outbound'], required: true },
    type: {
      type: String,
      enum: ['text', 'image', 'document', 'audio', 'template', 'system'],
      default: 'text',
    },
    text: { type: String },
    media: {
      mediaId: { type: String },
      url: { type: String },
      mimeType: { type: String },
      type: { type: String, enum: ['image', 'document', 'audio'] },
      filename: { type: String },
      size: { type: Number },
    },
    template: {
      name: { type: String },
      language: { type: String },
    },
    status: {
      type: String,
      enum: ['pending', 'sent', 'delivered', 'read', 'failed'],
      default: 'sent',
    },
    error: {
      code: { type: String },
      title: { type: String },
    },
    timestamp: { type: Date, default: Date.now, index: true },
    sentByUser: { type: mongoose.SchemaTypes.ObjectId, ref: 'User' },
    // Internal note (staff-only, never sent to WhatsApp) + voice-note duration.
    internal: { type: Boolean, default: false },
    durationSec: { type: Number },
    // Teammates @mentioned in an internal note (they get notified).
    mentions: [{ type: mongoose.SchemaTypes.ObjectId, ref: 'User' }],
  },
  { timestamps: true }
);

whatsappMessageSchema.plugin(toJSON);
whatsappMessageSchema.plugin(paginate);

module.exports = mongoose.model('WhatsappMessage', whatsappMessageSchema);
