const mongoose = require('mongoose');
const { toJSON, paginate } = require('./plugins');

// A per-user task / reminder — powers the counselor "My Desk" (Today's tasks,
// Overdue, Needs attention).
const reminderSchema = new mongoose.Schema(
  {
    // The counselor the reminder belongs to.
    user: { type: mongoose.SchemaTypes.ObjectId, ref: 'User', required: true },
    // Optional linked student.
    student: { type: mongoose.SchemaTypes.ObjectId, ref: 'Students' },
    // Optional linked lead — a follow-up set from the Leads page before the
    // lead is a student. On conversion the reminder also gets `student`.
    lead: { type: mongoose.SchemaTypes.ObjectId, ref: 'Leads' },
    title: { type: String, required: true, trim: true },
    note: { type: String, trim: true },
    dueDate: { type: Date, required: true },
    // call | email | document | follow-up | other
    type: { type: String, default: 'follow-up' },
    status: { type: String, enum: ['pending', 'completed', 'snoozed'], default: 'pending' },
    completedAt: { type: Date },
    createdBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

reminderSchema.plugin(toJSON);
reminderSchema.plugin(paginate);

// Per-counselor list, sorted/filtered by due date + status.
reminderSchema.index({ user: 1, status: 1, dueDate: 1 });
reminderSchema.index({ student: 1 });
reminderSchema.index({ lead: 1 });

module.exports = mongoose.model('Reminder', reminderSchema);
