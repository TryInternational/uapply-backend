/* eslint-disable no-param-reassign */
const mongoose = require('mongoose');
const { toJSON, paginate } = require('./plugins');

// An immutable audit entry on a student's timeline. Written server-side after
// meaningful mutations (stage advance, doc upload, assignment, edit, reminder,
// note) and client-side for things the server can't observe (logged calls /
// emails / WhatsApp sends). No update/delete — the timeline is append-only.
const ACTIVITY_TYPES = ['stage', 'call', 'whatsapp', 'email', 'doc', 'note', 'reminder', 'assignment', 'edit'];

const activitySchema = new mongoose.Schema(
  {
    student: { type: mongoose.SchemaTypes.ObjectId, ref: 'Students', required: true },
    type: { type: String, enum: ACTIVITY_TYPES, required: true },
    text: { type: String, required: true, trim: true },
    // Actor is denormalized (id + name) so each row renders "text · {date} · {user}"
    // without a join, and survives the actor later being renamed/removed.
    actorId: { type: mongoose.SchemaTypes.ObjectId, ref: 'User' },
    actorName: { type: String, trim: true },
    // Free-form context, e.g. { applicationId, phase, docId }.
    meta: { type: mongoose.SchemaTypes.Mixed },
  },
  {
    timestamps: true,
    // The shared toJSON plugin strips createdAt/updatedAt; the timeline is
    // ordered/labelled by createdAt, so re-add it (plugin chains this transform).
    toJSON: {
      transform(doc, ret) {
        ret.createdAt = doc.createdAt;
      },
    },
  }
);

activitySchema.plugin(toJSON);
activitySchema.plugin(paginate);

// Per-student timeline, newest first.
activitySchema.index({ student: 1, createdAt: -1 });

module.exports = mongoose.model('Activity', activitySchema);
module.exports.ACTIVITY_TYPES = ACTIVITY_TYPES;
