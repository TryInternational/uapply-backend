const mongoose = require('mongoose');
const { toJSON, paginate } = require('./plugins');

/**
 * A WhatsApp conversation with one contact (keyed by phone / Meta wa_id).
 * `assignees` is denormalized from the linked student's `assignedTo` so the
 * inbox can filter "My chats / Unassigned / All" without joining students on
 * every query. `windowExpiresAt` tracks the 24h customer-service window.
 */
const whatsappConversationSchema = mongoose.Schema(
  {
    contact: {
      phone: { type: String, required: true, index: true },
      name: { type: String },
      waId: { type: String, index: true },
    },
    student: { type: mongoose.SchemaTypes.ObjectId, ref: 'Students' },
    assignees: [
      {
        userId: { type: mongoose.SchemaTypes.ObjectId, ref: 'User' },
        role: { type: String },
      },
    ],
    lastMessage: {
      preview: { type: String },
      at: { type: Date },
      direction: { type: String, enum: ['inbound', 'outbound'] },
    },
    lastMessageAt: { type: Date, index: true },
    unreadCount: { type: Number, default: 0 },
    windowExpiresAt: { type: Date },
    // Handling state + triage (set by staff from the inbox).
    status: { type: String, enum: ['open', 'waiting', 'resolved'], default: 'open' },
    // When the chat was marked resolved (cleared when it is reopened) — what the
    // dashboard's "resolved in the period" counts by.
    resolvedAt: { type: Date },
    priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
    tags: [{ type: String }],
    nextFollowUpAt: { type: Date },
    // Last known Calling API permission for this contact (from call_permission_reply
    // webhooks / the call_permissions endpoint). 'temporary' carries an expiry.
    callPermission: {
      status: { type: String, enum: ['none', 'pending', 'temporary', 'permanent'] },
      expiresAt: { type: Date },
      requestedAt: { type: Date },
    },
  },
  { timestamps: true }
);

whatsappConversationSchema.plugin(toJSON);
whatsappConversationSchema.plugin(paginate);

// Performance indexes — inbox list filters by assignee, analytics by direction/student.
whatsappConversationSchema.index({ 'assignees.userId': 1 });
whatsappConversationSchema.index({ 'lastMessage.direction': 1 });
whatsappConversationSchema.index({ student: 1 });

module.exports = mongoose.model('WhatsappConversation', whatsappConversationSchema);
