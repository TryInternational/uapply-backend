/* eslint-disable no-console */
/**
 * Backfill `createdBy` on partner-referred students.
 *
 *   node src/migrations/partnerCreatedBy.migration.js            # dry run
 *   node src/migrations/partnerCreatedBy.migration.js --apply    # write
 *
 * WHY IT IS NEEDED
 * ----------------
 * `createdBy` is how the back office answers "who referred this student?" — the
 * line under the Channel badge in the student list — and how a partner's own
 * portal finds their students again. Two historical gaps left it empty:
 *
 *   1. The field was not declared on the students schema at first, so strict
 *      mode silently dropped it on write.
 *   2. It was later set from `req.user`, which these routes leave undefined
 *      whenever a partner's 30-minute access token has lapsed — softAuth lets
 *      the request through unauthenticated rather than rejecting it.
 *
 * Students from those windows show a channel badge with no name under it.
 *
 * WHAT IT DOES
 * ------------
 * For every student whose channel is 'subagent' or 'counselor' and whose
 * createdBy is missing, recover the submitter from the assignedTo entry that
 * points at a user holding an external-partner role — which is where the
 * partner used to be recorded before that self-assignment was removed.
 *
 * Students with no such entry cannot be attributed and are reported, not
 * guessed at: naming the wrong school on someone's record is worse than
 * leaving it blank.
 *
 * Idempotent: only touches documents where createdBy is absent.
 */
const mongoose = require('mongoose');
const config = require('../config/config');

const APPLY = process.argv.includes('--apply');

const run = async () => {
  await mongoose.connect(config.mongoose.url, config.mongoose.options);
  // eslint-disable-next-line global-require
  const { Students, User } = require('../models');

  const partnerRoleIds = [config.applications.subAgentRoleId, config.applications.schoolCounselorRoleId]
    .filter(Boolean)
    .map(String);

  if (!partnerRoleIds.length) {
    console.error('No partner role ids configured (SUB_AGENT_ROLE_ID / SCHOOL_COUNSELOR_ROLE_ID).');
    process.exit(1);
  }

  const partners = await User.find({ role: { $in: partnerRoleIds } }).select('_id name organisation role');
  const partnerIds = new Set(partners.map((u) => String(u._id)));
  console.log(`Partner accounts: ${partners.length}`);

  const candidates = await Students.find({
    channel: { $in: ['subagent', 'counselor'] },
    $or: [{ createdBy: { $exists: false } }, { createdBy: null }],
  }).select('_id firstName lastName channel assignedTo');

  console.log(`Students missing createdBy: ${candidates.length}`);

  let fixed = 0;
  const orphans = [];

  for (const s of candidates) {
    const hit = (s.assignedTo || []).find((a) => a && a.user && partnerIds.has(String(a.user)));
    if (!hit) {
      orphans.push(`${s._id} ${s.firstName || ''} ${s.lastName || ''} (${s.channel})`);
      continue;
    }
    if (APPLY) {
      // eslint-disable-next-line no-await-in-loop
      await Students.updateOne({ _id: s._id }, { $set: { createdBy: hit.user } });
    }
    fixed += 1;
  }

  console.log(`${APPLY ? 'Updated' : 'Would update'}: ${fixed}`);
  console.log(`Unattributable (left untouched): ${orphans.length}`);
  orphans.slice(0, 20).forEach((o) => console.log(`  - ${o}`));
  if (orphans.length > 20) console.log(`  ... and ${orphans.length - 20} more`);
  if (!APPLY) console.log('\nDry run. Re-run with --apply to write.');

  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
