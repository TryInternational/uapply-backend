const mongoose = require('mongoose');
const { toJSON, paginate, slug, mongooseHistory } = require('./plugins');

const commentSchema = new mongoose.Schema({
  studentId: { type: mongoose.SchemaTypes.ObjectId, ref: 'Students' },
  content: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  createdBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'Users', autopopulate: true },
});

commentSchema.plugin(toJSON);
commentSchema.plugin(paginate);
commentSchema.plugin(slug);
commentSchema.plugin(mongooseHistory);

module.exports = mongoose.model('Comment', commentSchema);
