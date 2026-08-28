/* eslint-disable no-console */
/**
 * Backfill the ülearn student attempt rollup.
 *
 *   node src/migrations/ulearnAttemptRollup.migration.js          # dry run
 *   node src/migrations/ulearnAttemptRollup.migration.js --apply  # write
 *
 * WHY IT IS NEEDED
 * ----------------
 * The back-office student list sorts on `lastAttemptAt`, a denormalised field
 * that `refreshAttemptRollup` maintains from now on. Existing student documents
 * predate it, so without this they all carry a null `lastAttemptAt`, sort last,
 * and show a zero attempt count — the list would look empty on day one.
 *
 * Idempotent: it recomputes from the three test collections rather than
 * incrementing, so running it twice produces the same result, and running it
 * again later is a safe way to repair drift.
 */
const mongoose = require('mongoose');
const config = require('../config/config');

const APPLY = process.argv.includes('--apply');
const BATCH = 200;

const run = async () => {
  await mongoose.connect(config.mongoose.url, config.mongoose.options);

  // required after connect so the models register against this connection
  // eslint-disable-next-line global-require
  const { UlearnStudent } = require('../models');
  // eslint-disable-next-line global-require
  const ulearnStudentService = require('../services/ulearnStudent.service');

  console.log(APPLY ? '=== APPLYING ===' : '=== DRY RUN (pass --apply to write) ===');

  const total = await UlearnStudent.countDocuments({});
  console.log(`ulearn students: ${total}`);

  let processed = 0;
  let withAttempts = 0;
  let cursor = UlearnStudent.find({}).select('_id').lean().cursor({ batchSize: BATCH });

  // eslint-disable-next-line no-restricted-syntax
  for await (const doc of cursor) {
    if (APPLY) {
      // eslint-disable-next-line no-await-in-loop
      await ulearnStudentService.refreshAttemptRollup(doc._id);
      // eslint-disable-next-line no-await-in-loop
      const after = await UlearnStudent.findById(doc._id).select('attemptCounts lastAttemptAt').lean();
      if (after && after.attemptCounts && after.attemptCounts.total > 0) withAttempts += 1;
    }
    processed += 1;
    if (processed % 250 === 0) console.log(`  …${processed}/${total}`);
  }

  console.log(`processed ${processed}`);
  if (APPLY) {
    console.log(`students with at least one linked attempt: ${withAttempts}`);
    const orphanCounts = await Promise.all(
      ['IeltsTest', 'AptitudeTest', 'Major'].map(async (name) => {
        // eslint-disable-next-line global-require
        const models = require('../models');
        const Model = models[name] || require(`../models/${name[0].toLowerCase()}${name.slice(1)}.model`);
        return Model.countDocuments({ studentId: null });
      })
    );
    console.log(
      `unclaimed (anonymous) attempts left behind — ielts ${orphanCounts[0]}, aptitude ${orphanCounts[1]}, major ${orphanCounts[2]}`
    );
    console.log('these belong to no student and do not appear in the CRM student list');
  } else {
    console.log('dry run complete — nothing was written');
  }

  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
