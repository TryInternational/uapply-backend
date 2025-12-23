const mongoose = require('mongoose');
const { toJSON, paginate, slug, trackable } = require('./plugins');

const commentSchema = new mongoose.Schema(
  {
    studentId: { type: mongoose.SchemaTypes.ObjectId, ref: 'Students' },
    content: { type: String, required: true },
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
  },
  {
    timestamps: true,
  }
);

commentSchema.plugin(toJSON);
commentSchema.plugin(paginate);
commentSchema.plugin(slug);
commentSchema.plugin(trackable);

module.exports = mongoose.model('Comment', commentSchema);
