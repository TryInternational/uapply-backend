/* eslint-disable no-console */
/**
 * Read-only, two databases at once: the counsellors' "+ Log" tally in
 * PRODUCTION against the students who applied in STAGING (the Trello import),
 * per counsellor and per degree, for the years given (default: last and this).
 *
 *   node scripts/compare-applied-by-counsellor.js [year]
 *
 * Staging side: a student counts once per intake they applied for (so a
 * re-application for a later intake counts again, as a counsellor would log
 * it), in the Kuwait month of the first application for that intake; the
 * counsellor is the student's sales owner.
 */
const path = require('path');

process.env.NODE_ENV = process.env.NODE_ENV || 'development';
const mongoose = require('mongoose');

const loadUrl = (env) => {
  // the config module reads .env.<APP_ENV> when first required — load it once per environment
  Object.keys(require.cache)
    .filter((k) => k.includes(`${path.sep}src${path.sep}config${path.sep}`))
    .forEach((k) => delete require.cache[k]);
  process.env.APP_ENV = env;
  // dotenv never overrides a variable that is already set, so the first
  // environment's database URL would otherwise leak into the second
  delete process.env.MONGODB_URL;
  // eslint-disable-next-line import/no-dynamic-require, global-require
  return require(path.join(__dirname, '..', 'src', 'config', 'config')).mongoose.url;
};

const TZ = 'Asia/Kuwait';
const LIVE = {
  reviewStatus: { $nin: ['DRAFT', 'SUBMITTED_BY_SUBAGENT', 'SUBMITTED_BY_COUNSELOR', 'REJECTED', 'RETURNED_FOR_EDIT'] },
};
const year = Number(process.argv[2]) || new Date().getFullYear();
const YEARS = [year - 1, year];
const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');

(async () => {
  const prodUrl = loadUrl('production');
  const stagUrl = loadUrl('staging');
  if (prodUrl === stagUrl) throw new Error('production and staging resolved to the same database URL — stopping');
  const prod = await mongoose.createConnection(prodUrl).asPromise();
  const stag = await mongoose.createConnection(stagUrl).asPromise();
  if (prod.name === stag.name) throw new Error(`both connections opened "${prod.name}" — stopping`);
  console.log(`production "${prod.name}" (tally, read-only)  vs  staging "${stag.name}" (Trello students)\n`);

  // ---- production tally: counsellor × year, degree × year
  const tally = await prod.db
    .collection('appliedstudents')
    .aggregate([
      { $match: { createdDate: { $ne: null } } },
      { $project: { y: { $year: { date: '$createdDate', timezone: TZ } }, number: 1, counsellor: 1, degree: 1 } },
      { $match: { y: { $in: YEARS } } },
      { $lookup: { from: 'users', localField: 'counsellor', foreignField: '_id', as: 'u' } },
      {
        $group: {
          _id: { who: { $ifNull: [{ $arrayElemAt: ['$u.name', 0] }, '(no counsellor)'] }, degree: '$degree', y: '$y' },
          n: { $sum: '$number' },
        },
      },
    ])
    .toArray();

  // ---- staging: Trello students, once per (student, intake), by sales owner
  const rows = await stag.db
    .collection('applications')
    .aggregate([
      { $match: { ...LIVE, studentId: { $ne: null } } },
      {
        $group: {
          _id: { s: '$studentId', iy: '$intakeYear', im: '$intakeMonth' },
          first: { $min: '$createdAt' },
          level: { $first: '$courseLevel' },
        },
      },
      { $lookup: { from: 'students', localField: '_id.s', foreignField: '_id', as: 'st' } },
      { $unwind: '$st' },
      { $match: { 'st.refrenceNo': /^TR-/ } },
      {
        $project: {
          y: { $year: { date: '$first', timezone: TZ } },
          level: 1,
          owner: {
            $let: {
              vars: {
                a: {
                  $filter: { input: { $ifNull: ['$st.assignedTo', []] }, as: 'x', cond: { $eq: ['$$x.role', 'sales'] } },
                },
              },
              in: { $arrayElemAt: ['$$a.user', 0] },
            },
          },
        },
      },
      { $match: { y: { $in: YEARS } } },
      { $lookup: { from: 'users', localField: 'owner', foreignField: '_id', as: 'u' } },
      { $addFields: { lvlOid: { $convert: { input: '$level', to: 'objectId', onError: null, onNull: null } } } },
      { $lookup: { from: 'courselevels', localField: 'lvlOid', foreignField: '_id', as: 'l' } },
      {
        $group: {
          _id: {
            who: { $ifNull: [{ $arrayElemAt: ['$u.name', 0] }, '(no sales owner)'] },
            degree: { $ifNull: [{ $arrayElemAt: ['$l.en_name', 0] }, '$level'] },
            y: '$y',
          },
          n: { $sum: 1 },
        },
      },
    ])
    .toArray();

  const table = (label, keyOf) => {
    const t = {};
    const add = (k, y, side, n) => {
      t[k] = t[k] || {};
      t[k][`${side}${y}`] = (t[k][`${side}${y}`] || 0) + n;
    };
    tally.forEach((r) => add(keyOf(r._id), r._id.y, 'tally', r.n));
    rows.forEach((r) => add(keyOf(r._id), r._id.y, 'crm', r.n));
    const keys = Object.keys(t).sort(
      (a, b) =>
        (t[b][`tally${year - 1}`] || 0) +
        (t[b][`tally${year}`] || 0) -
        ((t[a][`tally${year - 1}`] || 0) + (t[a][`tally${year}`] || 0))
    );
    console.log(`${label}`);
    console.log(`  ${''.padEnd(26)} ${YEARS.map((y) => `tally ${y}  CRM ${y}  diff`).join('   ')}`);
    const tot = {};
    keys.forEach((k) => {
      const cells = YEARS.map((y) => {
        const a = t[k][`tally${y}`] || 0;
        const b = t[k][`crm${y}`] || 0;
        tot[`t${y}`] = (tot[`t${y}`] || 0) + a;
        tot[`c${y}`] = (tot[`c${y}`] || 0) + b;
        return `${String(a).padStart(10)}${String(b).padStart(9)}${String(b - a).padStart(6)}`;
      });
      console.log(`  ${k.slice(0, 26).padEnd(26)} ${cells.join('   ')}`);
    });
    console.log(
      `  ${'total'.padEnd(26)} ${YEARS.map(
        (y) =>
          `${String(tot[`t${y}`] || 0).padStart(10)}${String(tot[`c${y}`] || 0).padStart(9)}${String(
            (tot[`c${y}`] || 0) - (tot[`t${y}`] || 0)
          ).padStart(6)}`
      ).join('   ')}\n`
    );
  };

  // names differ in spelling between the two systems — match on letters only
  const byName = {};
  [...tally, ...rows].forEach((r) => {
    const k = norm(r._id.who);
    if (!byName[k]) byName[k] = r._id.who;
  });
  table('By counsellor', (id) => byName[norm(id.who)] || id.who);
  table('By degree', (id) => {
    const d = String(id.degree || '').toLowerCase();
    if (d.includes('found')) return 'Foundation';
    if (d.includes('master') || d.includes('post')) return "Master's";
    if (d.includes('phd') || d.includes('doctor')) return 'PhD';
    if (d.includes('bachelor') || d.includes('under') || d.includes('year')) return "Bachelor's";
    return id.degree || '(no degree)';
  });

  await prod.close();
  await stag.close();
})().catch(async (e) => {
  console.error(e.message || e);
  process.exit(1);
});
