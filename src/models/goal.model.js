const mongoose = require('mongoose');
const { toJSON } = require('./plugins');

/**
 * Company goals for one calendar year — the design's Goals page
 * (Ulearn Dashboard Concepts · Admin A › avatar menu › Goals).
 *
 * One document per year. `goal` holds the four company targets; `split` says
 * which channel is expected to deliver how much of the applied goal. Admins
 * write it, everyone signed in may read it.
 */
const goalSchema = new mongoose.Schema(
  {
    year: { type: Number, required: true, unique: true, index: true },
    goal: {
      applied: { type: Number, default: 0, min: 0 },
      offers: { type: Number, default: 0, min: 0 },
      enrolled: { type: Number, default: 0, min: 0 },
      revenue: { type: Number, default: 0, min: 0 },
    },
    split: {
      counselors: { type: Number, default: 0, min: 0 },
      subagents: { type: Number, default: 0, min: 0 },
      schools: { type: Number, default: 0, min: 0 },
    },
    updatedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

goalSchema.plugin(toJSON);

module.exports = mongoose.model('Goal', goalSchema);
