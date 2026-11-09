/* eslint-disable no-console */
/**
 * Read-only: the three ways "Students who applied, this year vs last year"
 * can be counted, side by side, from this environment's database.
 *
 *   APP_ENV=staging    node scripts/check-applied-series.js
 *   APP_ENV=production node scripts/check-applied-series.js      (reads only)
 *
 *   tally     — the counsellors' "+ Log" entries (appliedstudents collection),
 *               summed by the Kuwait month of createdDate. What the OLD
 *               dashboard code shows.
 *   students  — each student once, in the Kuwait month of their first live
 *               application (createdAt). What the CURRENT dashboard shows.
 *   apps      — live applications created per month (one student can count
 *               several times). The "applications" fallback.
 */
const path = require('path');

process.env.APP_ENV = process.env.APP_ENV || 'staging';
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
const mongoose = require('mongoose');
// eslint-disable-next-line import/no-dynamic-require
const config = require(path.join(__dirname, '..', 'src', 'config', 'config'));

const TZ = 'Asia/Kuwait';
const LIVE = {
  reviewStatus: { $nin: ['DRAFT', 'SUBMITTED_BY_SUBAGENT', 'SUBMITTED_BY_COUNSELOR', 'REJECTED', 'RETURNED_FOR_EDIT'] },
};
const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const year = Number(process.argv[2]) || new Date().getFullYear();
const series = (rows, y, key = 'n') =>
  Array.from({ length: 12 }, (_, i) => (rows.find((r) => r._id.y === y && r._id.m === i + 1) || {})[key] || 0);
const line = (label, s) =>
  console.log(`  ${label.padEnd(12)} ${s.map((v) => String(v).padStart(4)).join('')}   = ${s.reduce((a, b) => a + b, 0)}`);

(async () => {
  await mongoose.connect(config.mongoose.url, config.mongoose.options);
  const db = mongoose.connection;
  console.log(`database ${db.name} · years ${year - 1} and ${year} · months in Kuwait time\n`);
  console.log(`  ${''.padEnd(12)} ${M.map((m) => m.padStart(4)).join('')}`);

  // 1. the counsellors' tally
  const tally = await db
    .collection('appliedstudents')
    .aggregate([
      { $match: { createdDate: { $ne: null } } },
      {
        $project: {
          y: { $year: { date: '$createdDate', timezone: TZ } },
          m: { $month: { date: '$createdDate', timezone: TZ } },
          number: 1,
        },
      },
      { $match: { y: { $in: [year - 1, year] } } },
      { $group: { _id: { y: '$y', m: '$m' }, n: { $sum: '$number' }, entries: { $sum: 1 } } },
    ])
    .toArray();
  console.log(`tally ("+ Log" entries: ${await db.collection('appliedstudents').countDocuments({})} in all)`);
  line(`${year - 1}`, series(tally, year - 1));
  line(`${year}`, series(tally, year));

  // 2. each student once, by first live application — split Trello-imported / CRM-native
  const first = await db
    .collection('applications')
    .aggregate([
      { $match: { ...LIVE, studentId: { $ne: null } } },
      { $group: { _id: '$studentId', first: { $min: '$createdAt' } } },
      { $lookup: { from: 'students', localField: '_id', foreignField: '_id', as: 's' } },
      { $match: { 's.0': { $exists: true } } },
      {
        $project: {
          y: { $year: { date: '$first', timezone: TZ } },
          m: { $month: { date: '$first', timezone: TZ } },
          trello: { $regexMatch: { input: { $ifNull: [{ $arrayElemAt: ['$s.refrenceNo', 0] }, ''] }, regex: /^TR-/ } },
          stage: { $arrayElemAt: ['$s.stage', 0] },
        },
      },
      { $match: { y: { $in: [year - 1, year] } } },
      {
        $group: {
          _id: { y: '$y', m: '$m' },
          n: { $sum: 1 },
          trello: { $sum: { $cond: ['$trello', 1, 0] } },
          lost: { $sum: { $cond: [{ $eq: ['$stage', 'Lost'] }, 1, 0] } },
        },
      },
    ])
    .toArray();
  console.log('\nstudents (each once, month of first live application) — the current dashboard');
  line(`${year - 1}`, series(first, year - 1));
  line(`${year}`, series(first, year));
  console.log('  of which from Trello:');
  line(`${year - 1}`, series(first, year - 1, 'trello'));
  line(`${year}`, series(first, year, 'trello'));
  console.log('  of which now Lost:');
  line(`${year - 1}`, series(first, year - 1, 'lost'));
  line(`${year}`, series(first, year, 'lost'));

  // 3. applications per month
  const apps = await db
    .collection('applications')
    .aggregate([
      { $match: LIVE },
      {
        $project: {
          y: { $year: { date: '$createdAt', timezone: TZ } },
          m: { $month: { date: '$createdAt', timezone: TZ } },
        },
      },
      { $match: { y: { $in: [year - 1, year] } } },
      { $group: { _id: { y: '$y', m: '$m' }, n: { $sum: 1 } } },
    ])
    .toArray();
  console.log('\napplications created per month (a student can count several times)');
  line(`${year - 1}`, series(apps, year - 1));
  line(`${year}`, series(apps, year));

  // 4. students by the month their card was created / they reached Applied
  const stu = await db
    .collection('students')
    .aggregate([
      { $match: { stage: { $in: ['Applied', 'Enrolled', 'Lost'] } } },
      {
        $project: {
          y: { $year: { date: '$createdAt', timezone: TZ } },
          m: { $month: { date: '$createdAt', timezone: TZ } },
        },
      },
      { $match: { y: { $in: [year - 1, year] } } },
      { $group: { _id: { y: '$y', m: '$m' }, n: { $sum: 1 } } },
    ])
    .toArray();
  console.log('\nstudents at Applied/Enrolled/Lost, by the month their record was created');
  line(`${year - 1}`, series(stu, year - 1));
  line(`${year}`, series(stu, year));

  await mongoose.disconnect();
})().catch(async (e) => {
  console.error(e.message || e);
  try {
    await mongoose.disconnect();
  } catch (_) {
    /* ignore */
  }
  process.exit(1);
});
