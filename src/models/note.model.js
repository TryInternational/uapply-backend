/* eslint-disable no-param-reassign */
const mongoose = require('mongoose');
const { toJSON, paginate } = require('./plugins');

// A lightweight, free-text note attached to a student — powers the Notes card
// on the redesigned student detail page. Distinct from Comments (mentions /
// reactions): Notes are a simpler, per-student jot with pin/edit/delete.
const noteSchema = new mongoose.Schema(
  {
    student: { type: mongoose.SchemaTypes.ObjectId, ref: 'Students', required: true },
    body: { type: String, required: true, trim: true },
    // Author is denormalized (id + name) so the list renders without a join,
    // matching how the frontend renders author + relative time.
    authorId: { type: mongoose.SchemaTypes.ObjectId, ref: 'User' },
    authorName: { type: String, trim: true },
    pinned: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    // The shared toJSON plugin strips createdAt/updatedAt; the Notes card needs
    // them, so re-add them here (the plugin chains this transform after its own).
    toJSON: {
      transform(doc, ret) {
        ret.createdAt = doc.createdAt;
        ret.updatedAt = doc.updatedAt;
      },
    },
  }
);

noteSchema.plugin(toJSON);
noteSchema.plugin(paginate);

// Per-student list, newest first (pinned ordering is applied in the service).
noteSchema.index({ student: 1, createdAt: -1 });

module.exports = mongoose.model('Note', noteSchema);
