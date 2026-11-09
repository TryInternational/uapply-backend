/* eslint-disable no-console, no-await-in-loop, no-restricted-syntax, no-continue */
/**
 * Fill `appliedAt` (and `journeys[].appliedAt`) on the Trello-imported students
 * in STAGING from the re-shaped export, without re-importing anything else.
 *
 *   node scripts/backfill-applied-at.js --env=staging --dir="…/shaped"            dry run
 *   node scripts/backfill-applied-at.js --env=staging --dir="…/shaped" --confirm=upply_staging
 *
 * `appliedAt` is the card's first move out of 🔥 Hot (or its creation straight
 * into an applied list) — the moment a counsellor logs the student as applied.
 */
const fs = require('fs');
const path = require('path');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.length ? v.join('=') : true];
  })
);
if (args.env !== 'staging' || !args.dir) {
  console.error('Usage: node scripts/backfill-applied-at.js --env=staging --dir=<shaped folder> [--confirm=<db name>]');
  process.exit(1);
}
process.env.APP_ENV = 'staging';
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
const mongoose = require('mongoose');
// eslint-disable-next-line import/no-dynamic-require
const config = require(path.join(__dirname, '..', 'src', 'config', 'config'));

(async () => {
  const rows = [];
  for (const b of fs.readdirSync(args.dir)) {
    const f = path.join(args.dir, b, 'students.jsonl');
    if (!fs.existsSync(f)) continue;
    fs.readFileSync(f, 'utf8')
      .split('\n')
      .filter(Boolean)
      .forEach((l) => {
        const s = JSON.parse(l);
        rows.push({
          ref: s.ref,
          appliedAt: s.appliedAt || null,
          journeys: (s.journeys || []).map((j) => j.appliedAt || null),
        });
      });
  }
  console.log(
    `${rows.length} shaped students · ${rows.filter((r) => r.appliedAt).length} with appliedAt · ${rows.reduce(
      (n, r) => n + r.journeys.filter(Boolean).length,
      0
    )} journeys with appliedAt`
  );

  await mongoose.connect(config.mongoose.url, config.mongoose.options);
  const db = mongoose.connection;
  const write = !!args.confirm;
  if (write && args.confirm !== db.name) {
    console.error(`--confirm=${args.confirm} does not match "${db.name}". Nothing written.`);
    await mongoose.disconnect();
    process.exit(1);
  }
  const S = db.collection('students');
  let matched = 0;
  let changed = 0;
  let journeyMismatch = 0;
  for (const r of rows) {
    const st = await S.findOne({ refrenceNo: r.ref }, { projection: { appliedAt: 1, journeys: 1 } });
    if (!st) continue;
    matched += 1;
    const set = {};
    const want = r.appliedAt ? new Date(r.appliedAt) : null;
    if ((st.appliedAt ? st.appliedAt.getTime() : null) !== (want ? want.getTime() : null)) set.appliedAt = want;
    const js = Array.isArray(st.journeys) ? st.journeys : [];
    if (js.length === r.journeys.length) {
      r.journeys.forEach((ja, i) => {
        const have = js[i] && js[i].appliedAt ? new Date(js[i].appliedAt).getTime() : null;
        const w = ja ? new Date(ja) : null;
        if (have !== (w ? w.getTime() : null)) set[`journeys.${i}.appliedAt`] = w;
      });
    } else if (r.journeys.length) journeyMismatch += 1;
    if (!Object.keys(set).length) continue;
    changed += 1;
    if (write) await S.updateOne({ _id: st._id }, { $set: set });
  }
  console.log(
    `${write ? 'updated' : 'would update'} ${changed} of ${matched} matched students in "${db.name}"${
      journeyMismatch ? ` · ${journeyMismatch} journey lists differ in length (skipped those journeys)` : ''
    }`
  );
  if (!write) console.log('Dry run — add --confirm=upply_staging to write.');
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
