const mongoose = require('mongoose');
const { toJSON, paginate, slug, mongooseHistory } = require('./plugins');

const commentSchema = new mongoose.Schema(
  {
    studentId: { type: mongoose.SchemaTypes.ObjectId, ref: 'Students' },
    content: { type: String, required: true },
    dateTime: { type: Date, default: Date.now },
    createdBy: { type: String, required: true },
    taggedUsers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    userId: { type: mongoose.SchemaTypes.ObjectId, ref: 'Users', autopopulate: true },
  },
  {
    timestamps: true,
  }
);

commentSchema.plugin(toJSON);
commentSchema.plugin(paginate);
commentSchema.plugin(slug);
commentSchema.plugin(mongooseHistory);

module.exports = mongoose.model('Comment', commentSchema);
