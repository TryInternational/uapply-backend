const { SlaSetting } = require('../models');

/**
 * The eight pipeline phases and the allowances the CRM shipped with.
 *
 * These stay the source of the DEFAULTS, so a database with no settings
 * document behaves exactly as the hardcoded constants did — the change is
 * "these are now editable", not "these are now different". Six phases have no
 * allowance because none was ever defined for them; an admin can now give them
 * one, which is the point of the exercise.
 */
const DEFAULT_PHASES = [
  { status: 'Initiated', value: 4, unit: 'hours', levels: {} },
  {
    status: 'Submitted',
    value: 20,
    unit: 'days',
    levels: { Foundation: 4, Bachelor: 20, Master: 20, PhD: 30 },
  },
  { status: 'Conditional offer', value: 0, unit: 'days', levels: {} },
  { status: 'Unconditional offer', value: 0, unit: 'days', levels: {} },
  { status: 'Confirmation', value: 0, unit: 'days', levels: {} },
  { status: 'FG/BS', value: 0, unit: 'days', levels: {} },
  { status: 'CAS Received', value: 0, unit: 'days', levels: {} },
  { status: 'Done', value: 0, unit: 'days', levels: {} },
];

const DEFAULTS = {
  key: 'default',
  phases: DEFAULT_PHASES,
  workWeek: [0, 1, 2, 3, 4],
  workStartHour: 9,
  workEndHour: 18,
  atRiskAt: 0.8,
};

/**
 * Read the settings, creating them from the defaults on first use.
 *
 * Any phase missing from a stored document is filled in from the defaults, so
 * adding a phase to the pipeline later cannot leave the settings half-formed.
 */
const getSettings = async () => {
  let doc = await SlaSetting.findOne({ key: 'default' });
  if (!doc) doc = await SlaSetting.create(DEFAULTS);

  const byStatus = new Map((doc.phases || []).map((p) => [p.status, p]));
  const merged = DEFAULT_PHASES.map((d) => {
    const stored = byStatus.get(d.status);
    if (!stored) return d;
    return {
      status: d.status,
      value: typeof stored.value === 'number' ? stored.value : d.value,
      unit: stored.unit || d.unit,
      levels: stored.levels || {},
    };
  });

  return {
    phases: merged,
    workWeek: doc.workWeek && doc.workWeek.length ? doc.workWeek : DEFAULTS.workWeek,
    workStartHour: typeof doc.workStartHour === 'number' ? doc.workStartHour : DEFAULTS.workStartHour,
    workEndHour: typeof doc.workEndHour === 'number' ? doc.workEndHour : DEFAULTS.workEndHour,
    atRiskAt: typeof doc.atRiskAt === 'number' ? doc.atRiskAt : DEFAULTS.atRiskAt,
    updatedAt: doc.updatedAt,
  };
};

const KNOWN_PHASES = new Set(DEFAULT_PHASES.map((p) => p.status));
const LEVELS = ['Foundation', 'Bachelor', 'Master', 'PhD'];

/**
 * Validate and store. Rejected rather than coerced, because a silently
 * clamped SLA is worse than an error: the admin would believe they had set
 * something they had not.
 */
const saveSettings = async (body, actorId) => {
  const errors = [];
  const phases = [];

  (Array.isArray(body.phases) ? body.phases : []).forEach((p) => {
    if (!p || !KNOWN_PHASES.has(p.status)) {
      errors.push(`Unknown phase "${p && p.status}"`);
      return;
    }
    const value = Number(p.value);
    if (!Number.isFinite(value) || value < 0) {
      errors.push(`${p.status}: the allowance must be zero or more`);
      return;
    }
    if (p.unit && !['hours', 'days'].includes(p.unit)) {
      errors.push(`${p.status}: unit must be hours or days`);
      return;
    }
    const levels = {};
    LEVELS.forEach((lvl) => {
      const raw = p.levels && p.levels[lvl];
      if (raw === null || raw === undefined || raw === '') return;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) {
        errors.push(`${p.status} · ${lvl}: the allowance must be zero or more`);
        return;
      }
      levels[lvl] = n;
    });
    phases.push({ status: p.status, value, unit: p.unit || 'days', levels });
  });

  const workWeek = Array.isArray(body.workWeek)
    ? body.workWeek.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    : DEFAULTS.workWeek;
  if (!workWeek.length) errors.push('At least one working day is required');

  const startHour = body.workStartHour === undefined ? DEFAULTS.workStartHour : Number(body.workStartHour);
  const endHour = body.workEndHour === undefined ? DEFAULTS.workEndHour : Number(body.workEndHour);
  if (!Number.isFinite(startHour) || startHour < 0 || startHour > 23) errors.push('Start hour must be 0–23');
  if (!Number.isFinite(endHour) || endHour < 1 || endHour > 24) errors.push('End hour must be 1–24');
  // An empty or inverted working day would make every hour-based SLA either
  // never elapse or elapse instantly.
  if (Number.isFinite(startHour) && Number.isFinite(endHour) && endHour <= startHour) {
    errors.push('The working day must end after it starts');
  }

  const atRiskAt = body.atRiskAt === undefined ? DEFAULTS.atRiskAt : Number(body.atRiskAt);
  if (!Number.isFinite(atRiskAt) || atRiskAt < 0.1 || atRiskAt > 1) {
    errors.push('The amber threshold must be between 0.1 and 1');
  }

  if (errors.length) {
    const err = new Error(errors.join('; '));
    err.validation = true;
    throw err;
  }

  await SlaSetting.findOneAndUpdate(
    { key: 'default' },
    {
      $set: {
        phases: phases.length ? phases : DEFAULT_PHASES,
        workWeek,
        workStartHour: startHour,
        workEndHour: endHour,
        atRiskAt,
        updatedBy: actorId || undefined,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return getSettings();
};

module.exports = { getSettings, saveSettings, DEFAULTS, DEFAULT_PHASES };
