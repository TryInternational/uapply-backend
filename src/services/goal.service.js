const { Goal, Application, Fees, Students } = require('../models');
const { LIVE_ONLY, firstLiveApplications } = require('./application.service');

const METRICS = ['applied', 'offers', 'enrolled', 'revenue'];
const CHANNELS = ['counselors', 'subagents', 'schools'];

// A calendar year in Kuwait time (UTC+3, no DST) — the dashboard's months are Kuwait months.
const KW_OFFSET_MS = 3 * 60 * 60 * 1000;
const yearRange = (year) => ({
  $gte: new Date(Date.UTC(year, 0, 1) - KW_OFFSET_MS),
  $lt: new Date(Date.UTC(year + 1, 0, 1) - KW_OFFSET_MS),
});
const OFFER_IDX = 2; // Conditional offer
const idOf = (x) => String((x && (x._id || x.id)) || x || '');

/**
 * What a year actually delivered, by the dashboard's definitions so a goal
 * and the dashboard never disagree:
 *   applied  — students whose FIRST live application was created that year
 *              (each student once — the dashboard's "Students who applied")
 *   offers   — of those, enrolled or a live, not-rejected application that
 *              reached Conditional offer or later
 *   enrolled — of those, ever enrolled
 *   revenue  — office-fee amounts recorded that year (KD)
 * and the applied count by channel (the student's acquisition channel:
 * sub-agent portal, school-counsellor portal, everything else = counsellor team).
 * It used to count APPLICATIONS past Initiated, so "Students applied" read
 * higher than the dashboard (183 vs 154) for the same year.
 */
const actualsFor = async (year) => {
  // required here: dashboardBreakdowns.service loads application.service
  // eslint-disable-next-line global-require
  const { reachedIdx } = require('./dashboardBreakdowns.service');
  // one row per student AND intake (the dashboard's definition); the student
  // lists below are per student
  const firsts = await Application.aggregate([...firstLiveApplications(), { $match: { first: yearRange(year) } }]);
  const ids = [...new Set(firsts.map((f) => String(f._id.student)))];
  const [students, apps] = ids.length
    ? await Promise.all([
        Students.find(
          { _id: { $in: ids } },
          { stage: 1, channel: 1, 'journeys.outcome': 1 },
          { autopopulate: false }
        ).lean(),
        Application.find(
          { ...LIVE_ONLY, studentId: { $in: ids } },
          { studentId: 1, rejected: 1, 'portalApplicationStatus.applicationPhases': 1 },
          { autopopulate: false }
        ).lean(),
      ])
    : [[], []];
  const appsBy = new Map();
  apps.forEach((a) => appsBy.set(idOf(a.studentId), (appsBy.get(idOf(a.studentId)) || []).concat(a)));

  // applied = once per intake applied for, as on the dashboard card
  const a = { applied: firsts.length, offers: 0, enrolled: 0, subagents: 0, schools: 0 };
  students.forEach((st) => {
    const enrolled =
      st.stage === 'Enrolled' || (Array.isArray(st.journeys) && st.journeys.some((j) => j && j.outcome === 'Enrolled'));
    const offer = enrolled || (appsBy.get(idOf(st)) || []).some((x) => !x.rejected && reachedIdx(x) >= OFFER_IDX);
    if (offer) a.offers += 1;
    if (enrolled) a.enrolled += 1;
    if (st.channel === 'subagent') a.subagents += 1;
    else if (st.channel === 'counselor') a.schools += 1;
  });

  const [fees] = await Fees.aggregate([
    { $match: { feeType: 'office-fees' } },
    { $addFields: { _d: { $ifNull: ['$createdDate', '$createdAt'] } } },
    { $match: { _d: yearRange(year) } },
    {
      $group: {
        _id: null,
        revenue: {
          $sum: {
            $convert: { input: '$tag.amount', to: 'double', onError: 0, onNull: 0 },
          },
        },
      },
    },
  ]);

  const { applied } = a;
  return {
    totals: {
      applied,
      offers: a.offers || 0,
      enrolled: a.enrolled || 0,
      revenue: Math.round((fees && fees.revenue) || 0),
    },
    split: {
      counselors: applied - (a.subagents || 0) - (a.schools || 0),
      subagents: a.subagents || 0,
      schools: a.schools || 0,
    },
  };
};

/** Last year plus `pct`% — the design's starting point when nothing is saved yet. */
const suggest = (last, lastSplit, pct = 10) => {
  const f = 1 + pct / 100;
  const goal = {};
  METRICS.forEach((k) => {
    goal[k] = k === 'revenue' ? Math.round((last[k] * f) / 100) * 100 : Math.round(last[k] * f);
  });
  const lt = CHANNELS.reduce((n, c) => n + (lastSplit[c] || 0), 0);
  const split = {};
  let acc = 0;
  CHANNELS.forEach((c, i) => {
    const share = lt ? (lastSplit[c] || 0) / lt : 1 / CHANNELS.length;
    const v = i === CHANNELS.length - 1 ? goal.applied - acc : Math.round(goal.applied * share);
    split[c] = Math.max(0, v);
    acc += split[c];
  });
  return { goal, split };
};

const getGoals = async (year) => {
  const [doc, last, sofar] = await Promise.all([Goal.findOne({ year }), actualsFor(year - 1), actualsFor(year)]);
  const base = doc ? { goal: doc.goal, split: doc.split } : suggest(last.totals, last.split);
  const pick = (src, keys) => keys.reduce((o, k) => ({ ...o, [k]: Number((src && src[k]) || 0) }), {});
  return {
    year,
    isSet: !!doc,
    goal: pick(base.goal, METRICS),
    split: pick(base.split, CHANNELS),
    last: last.totals,
    lastSplit: last.split,
    sofar: sofar.totals,
    updatedAt: doc ? doc.updatedAt : null,
  };
};

const saveGoals = async (year, body, actorId) => {
  const errors = [];
  const clean = (src, keys, what) =>
    keys.reduce((o, k) => {
      const n = Number(src && src[k]);
      if (!Number.isFinite(n) || n < 0) {
        errors.push(`${what} "${k}" must be zero or more`);
        return o;
      }
      return { ...o, [k]: Math.round(n) };
    }, {});
  const goal = clean(body.goal, METRICS, 'Goal');
  const split = clean(body.split, CHANNELS, 'Split');
  if (errors.length) {
    const err = new Error(errors.join('; '));
    err.validation = true;
    throw err;
  }
  await Goal.findOneAndUpdate(
    { year },
    { $set: { year, goal, split, updatedBy: actorId || undefined } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return getGoals(year);
};

module.exports = { getGoals, saveGoals, actualsFor, suggest };
