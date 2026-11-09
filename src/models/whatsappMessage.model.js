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
    // Unique per Meta wamid so a retried webhook can never double-insert; sparse
    // because internal notes and stub-mode sends have no wamid.
    waMessageId: { type: String, index: { unique: true, sparse: true } },
    clientRef: { type: String },
    // Set when the message was produced by a broadcast (counters derive from it).
    broadcast: { type: mongoose.SchemaTypes.ObjectId, ref: 'WhatsappBroadcast', index: true },
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
    // Set when staff filed this inbound photo/document into the student record.
    savedDocument: {
      id: { type: mongoose.SchemaTypes.ObjectId, ref: 'Documents' },
      label: { type: String },
      docTypeKey: { type: String },
    },
    // Teammates @mentioned in an internal note (they get notified).
    mentions: [{ type: mongoose.SchemaTypes.ObjectId, ref: 'User' }],
  },
  { timestamps: true }
);

whatsappMessageSchema.plugin(toJSON);
whatsappMessageSchema.plugin(paginate);

module.exports = mongoose.model('WhatsappMessage', whatsappMessageSchema);
