const mongoose = require('mongoose');
const { toJSON, paginate } = require('./plugins');

/**
 * One WhatsApp voice call (Meta Calling API). `waCallId` is Meta's call id,
 * used to reconcile the `calls` webhooks (connect / status / terminate).
 * Status mirrors the client state machine in the CRM (src/types/whatsapp.ts).
 */
const whatsappCallSchema = mongoose.Schema(
  {
    conversation: { type: mongoose.SchemaTypes.ObjectId, ref: 'WhatsappConversation', required: true, index: true },
    waCallId: { type: String, index: true },
    direction: { type: String, enum: ['business_initiated', 'user_initiated'], required: true },
    status: {
      type: String,
      enum: ['ringing', 'connecting', 'in_call', 'ended', 'failed', 'rejected', 'missed'],
      default: 'ringing',
    },
    endReason: { type: String, enum: ['completed', 'failed', 'rejected', 'no_answer', 'out_of_hours', 'no_permission'] },
    startedAt: { type: Date, default: Date.now },
    connectedAt: { type: Date },
    endedAt: { type: Date },
    durationSec: { type: Number },
    initiatedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User' },
    error: { code: { type: String }, title: { type: String } },
    // Inbound: the caller's SDP offer, kept until a counsellor answers from the browser.
    sdpOffer: { type: String },
  },
  { timestamps: true }
);

whatsappCallSchema.plugin(toJSON);
whatsappCallSchema.plugin(paginate);

module.exports = mongoose.model('WhatsappCall', whatsappCallSchema);
