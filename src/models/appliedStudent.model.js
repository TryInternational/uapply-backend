const mongoose = require('mongoose');
const { toJSON, paginate, slug, mongooseHistory } = require('./plugins');

const appliedStudentSchema = new mongoose.Schema(
  {
    number: { type: Number, required: true },
    createdDate: {
      type: Date,
    },
    userId: { type: mongoose.SchemaTypes.ObjectId, ref: 'User' },
  },
  {
    timestamps: true,
  }
);

appliedStudentSchema.plugin(toJSON);
appliedStudentSchema.plugin(paginate);
appliedStudentSchema.plugin(slug);
appliedStudentSchema.plugin(mongooseHistory);

module.exports = mongoose.model('AppliedStudent', appliedStudentSchema);
