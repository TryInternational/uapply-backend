const mongoose = require('mongoose');
const { toJSON, paginate, slug, trackable } = require('./plugins');

const appliedStudentSchema = new mongoose.Schema(
  {
    number: { type: Number, required: true },
    role: { type: mongoose.SchemaTypes.ObjectId, ref: 'Role' },
    createdDate: {
      type: Date,
    },
    degree: { type: String, required: true },
    counsellor: { type: mongoose.SchemaTypes.ObjectId, ref: 'User' },
    userId: { type: mongoose.SchemaTypes.ObjectId, ref: 'User' },
  },
  {
    timestamps: true,
  }
);

appliedStudentSchema.plugin(toJSON);
appliedStudentSchema.plugin(paginate);
appliedStudentSchema.plugin(slug);
appliedStudentSchema.plugin(trackable);

module.exports = mongoose.model('AppliedStudent', appliedStudentSchema);
