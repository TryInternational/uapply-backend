/* eslint-disable no-console */
/**
 * One-off migration for ulearn phone sign-in.
 *
 *   node src/migrations/ulearnPhoneAuth.migration.js          # dry run
 *   node src/migrations/ulearnPhoneAuth.migration.js --apply  # make changes
 *
 * WHY IT IS NEEDED
 * ----------------
 * The ulearnstudents collection already carries two UNIQUE indexes created from
 * the old schema: googleId_1 and email_1. Both are now optional fields, and a
 * plain unique index treats every missing value as the same null — so the
 * SECOND phone-only account would be rejected as a duplicate key. Mongoose
 * cannot replace those indexes on its own either: creating {email: 1} with a
 * different `partialFilterExpression` against an existing {email: 1} raises
 * IndexOptionsConflict. They have to be dropped first, once.
 *
 * Also backfills emailVerified on the existing Google-authenticated rows. Those
 * accounts really do hold a Google-verified email, and the model default flipped
 * from true to false — without this backfill they would silently lose the right
 * to claim attempts by email.
 *
 * Safe to run more than once. Makes no destructive change to any document field
 * other than setting emailVerified/authProvider where they are absent.
 */
const mongoose = require('mongoose');
const config = require('../config/config');

const APPLY = process.argv.includes('--apply');
const OBSOLETE_INDEXES = ['googleId_1', 'email_1'];

const run = async () => {
  await mongoose.connect(config.mongoose.url, config.mongoose.options);
  const collection = mongoose.connection.collection('ulearnstudents');

  console.log(APPLY ? '=== APPLYING ===' : '=== DRY RUN (pass --apply to change anything) ===');

  // 1. drop the obsolete non-partial unique indexes
  const indexes = await collection.indexes();
  const names = indexes.map((i) => i.name);
  for (const name of OBSOLETE_INDEXES) {
    const existing = indexes.find((i) => i.name === name);
    if (!existing) {
      console.log(`index ${name}: absent, nothing to do`);
      continue;
    }
    if (existing.partialFilterExpression) {
      console.log(`index ${name}: already partial, leaving as is`);
      continue;
    }
    console.log(`index ${name}: non-partial unique — will drop`);
    if (APPLY) {
      // eslint-disable-next-line no-await-in-loop
      await collection.dropIndex(name);
      console.log(`index ${name}: dropped`);
    }
  }
  console.log('current indexes:', names.join(', '));

  // 2. backfill emailVerified/authProvider on legacy Google rows
  const legacyFilter = { googleId: { $type: 'string' }, emailVerified: { $ne: true } };
  const legacyCount = await collection.countDocuments(legacyFilter);
  console.log(`legacy Google accounts needing emailVerified=true: ${legacyCount}`);
  if (APPLY && legacyCount) {
    const result = await collection.updateMany(legacyFilter, {
      $set: { emailVerified: true, authProvider: 'google' },
    });
    console.log(`updated ${result.modifiedCount}`);
  }

  // 3. report how many rows carry an unverified free-form phone. These are NOT
  //    touched: they stay unverified, so the new partial unique index on
  //    {phone: 1} (filtered to phoneVerified:true) cannot collide with them.
  const freeform = await collection.countDocuments({
    phone: { $nin: [null, ''] },
    phoneVerified: { $ne: true },
  });
  console.log(`accounts with an unverified self-typed phone (left untouched): ${freeform}`);

  // 4. the new indexes are declared in the model and created by Mongoose on
  //    next boot with autoIndex enabled. Report whether they exist yet.
  const after = (await collection.indexes()).map((i) => i.name);
  ['firebaseUid_1', 'phone_1', 'phoneNational_1'].forEach((n) => {
    console.log(`index ${n}: ${after.includes(n) ? 'present' : 'not created yet (app boot will create it)'}`);
  });

  await mongoose.disconnect();
  console.log(APPLY ? 'done' : 'dry run complete — no changes were made');
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
