const mongoose = require('mongoose');
const { toJSON, paginate, slug, trackable } = require('./plugins');

const commentSchema = new mongoose.Schema(
  {
    studentId: { type: mongoose.SchemaTypes.ObjectId, ref: 'Students' },
    content: { type: String },
    dateTime: { type: Date, default: Date.now },
    updatedDate: { type: Date },
    createdBy: { type: String, required: true },

    reactions: [
      {
        emoji: { type: String, required: true },
        users: [
          {
            userId: { type: mongoose.Schema.Types.ObjectId, ref: 'Users' },
            name: { type: String },
            _id: false,
          },
        ],
        _id: false,
      },
    ],
    taggedUsers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    userId: { type: mongoose.SchemaTypes.ObjectId, ref: 'Users', autopopulate: true },

    images: [
      // Add this array attribute
      {
        type: String, // Assuming the images are stored as URLs
      },
    ],
    // Non-image attachments (the profile's comment composer): name, storage
    // URL and a display size. Optional; older comments simply have none.
    files: [
      {
        name: String,
        url: String,
        size: String,
        _id: false,
      },
    ],
    // Pinned comments sort to the top of the student's thread.
    pinned: { type: Boolean, default: false },
  },
  {
    timestamps: true,
  }
);

commentSchema.plugin(toJSON);
commentSchema.plugin(paginate);
commentSchema.plugin(slug);
commentSchema.plugin(trackable);

// Performance index — comments are fetched per student on every profile open.
commentSchema.index({ studentId: 1 });

module.exports = mongoose.model('Comment', commentSchema);
