/* eslint-disable no-console */
/**
 * Read-only: the counsellors' "+ Log" entries for one month, one line each
 * (Kuwait date · counsellor · degree · number), from the environment given.
 *
 *   APP_ENV=production node scripts/applied-log-month.js 2026-10
 */
const path = require('path');

process.env.APP_ENV = process.env.APP_ENV || 'production';
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
const mongoose = require('mongoose');
// eslint-disable-next-line import/no-dynamic-require
const config = require(path.join(__dirname, '..', 'src', 'config', 'config'));

const month = process.argv[2] || new Date().toISOString().slice(0, 7);
const [y, m] = month.split('-').map(Number);
// Kuwait is UTC+3 all year
const start = new Date(Date.UTC(y, m - 1, 1, -3));
const end = new Date(Date.UTC(y, m, 1, -3));

(async () => {
  await mongoose.connect(config.mongoose.url, config.mongoose.options);
  const db = mongoose.connection;
  const rows = await db
    .collection('appliedstudents')
    .aggregate([
      { $match: { createdDate: { $gte: start, $lt: end } } },
      { $lookup: { from: 'users', localField: 'counsellor', foreignField: '_id', as: 'u' } },
      {
        $project: {
          createdDate: 1,
          number: 1,
          degree: 1,
          createdAt: 1,
          who: { $ifNull: [{ $arrayElemAt: ['$u.name', 0] }, '(no counsellor)'] },
        },
      },
      { $sort: { createdDate: 1 } },
    ])
    .toArray();
  console.log(
    `database ${db.name} · ${month} · ${rows.length} log entries · ${rows.reduce(
      (n, r) => n + (r.number || 0),
      0
    )} students logged`
  );
  rows.forEach((r) => {
    const d = new Date(r.createdDate).toLocaleString('en-GB', {
      timeZone: 'Asia/Kuwait',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
    const typed = r.createdAt
      ? new Date(r.createdAt).toLocaleString('en-GB', { timeZone: 'Asia/Kuwait', day: '2-digit', month: 'short' })
      : '';
    console.log(
      `  ${d}  ${String(r.who).padEnd(22)} ${String(r.degree || '—').padEnd(12)} ×${r.number}${
        typed && typed !== d.slice(0, 6) ? `   (typed ${typed})` : ''
      }`
    );
  });
  await mongoose.disconnect();
})().catch(async (e) => {
  console.error(e.message || e);
  process.exit(1);
});
