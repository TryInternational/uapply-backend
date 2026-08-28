const mongoose = require('mongoose');
const { toJSON } = require('./plugins');

/**
 * SLA configuration — one document for the whole tenant.
 *
 * The allowances used to be constants compiled into the CRM bundle, so
 * changing "how long may an application sit in Submitted" meant a code edit
 * and a deploy. They live here instead, with the same values as defaults, so
 * an admin can set them and every surface that reads the SLA (the pipeline
 * rings and hover card, the Students "Overdue" filter, the dashboard's overdue
 * count) moves together.
 *
 * Kept as a singleton rather than a row per phase: the working week and hours
 * are shared by every phase, and reading one document keeps the CRM's startup
 * fetch to a single request.
 */
const phaseRuleSchema = new mongoose.Schema(
  {
    // One of the eight pipeline phases.
    status: { type: String, required: true, trim: true },
    // 0 (or absent) means the phase has no SLA and never goes overdue —
    // which is how six of the eight behave today.
    value: { type: Number, default: 0, min: 0 },
    unit: { type: String, enum: ['hours', 'days'], default: 'days' },
    /**
     * Per-degree-level allowances, e.g. Submitted is 4 business days for a
     * Foundation but 30 for a PhD. A level absent here falls back to `value`.
     */
    levels: {
      Foundation: { type: Number, default: null },
      Bachelor: { type: Number, default: null },
      Master: { type: Number, default: null },
      PhD: { type: Number, default: null },
    },
  },
  { _id: false }
);

const slaSettingSchema = new mongoose.Schema(
  {
    // Singleton discriminator; the service always reads/writes key 'default'.
    key: { type: String, default: 'default', unique: true, index: true },
    phases: { type: [phaseRuleSchema], default: [] },
    /**
     * Working days as JS getDay() indices, 0 = Sunday. Defaults to the Gulf
     * week (Sun–Thu) the CRM already assumed.
     */
    workWeek: { type: [Number], default: [0, 1, 2, 3, 4] },
    workStartHour: { type: Number, default: 9, min: 0, max: 23 },
    workEndHour: { type: Number, default: 18, min: 1, max: 24 },
    /** Fraction of the window after which a phase shows amber. */
    atRiskAt: { type: Number, default: 0.8, min: 0.1, max: 1 },
    updatedBy: { type: mongoose.SchemaTypes.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

slaSettingSchema.plugin(toJSON);

module.exports = mongoose.model('SlaSetting', slaSettingSchema);
