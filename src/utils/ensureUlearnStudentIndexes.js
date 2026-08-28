/* eslint-disable no-console */
const mongoose = require('mongoose');
const logger = require('../config/logger');

/**
 * Drop the obsolete unique indexes on the ulearnstudents collection.
 *
 * WHY THIS RUNS ON BOOT RATHER THAN AS A MIGRATION
 * ------------------------------------------------
 * `googleId` and `email` became OPTIONAL when phone sign-in replaced Google
 * sign-in, and the model now declares PARTIAL unique indexes filtered to
 * documents where the field is actually a string. The collection, however,
 * still carries the original `unique: true` indexes, and a plain unique index
 * treats every document MISSING the field as holding the same `null`. So the
 * first phone-only student inserts fine and the second fails with:
 *
 *     MongoServerError E11000 duplicate key ... index: googleId_1 dup key: null
 *
 * There is no code-level way around that — two documents cannot both omit a
 * uniquely-indexed field. The index has to go.
 *
 * `src/migrations/ulearnPhoneAuth.migration.js` does this too and remains the
 * right tool when you have a shell on the database. This exists because a
 * deployed environment often has no such shell, and a fix that requires one is
 * a fix that does not happen. Doing it here means a redeploy is enough.
 *
 * Safe to run on every boot:
 *  - it only touches two named indexes, never anything else;
 *  - an index that is already partial is left alone;
 *  - an index that is already gone is a no-op;
 *  - any failure is logged and swallowed, because a index-tidying step must
 *    never stop the server from starting.
 *
 * Mongoose creates the replacement partial indexes itself via autoIndex.
 *
 * @returns {Promise<void>}
 */
const OBSOLETE = ['googleId_1', 'email_1'];

const ensureUlearnStudentIndexes = async () => {
  try {
    const collection = mongoose.connection.collection('ulearnstudents');

    let indexes;
    try {
      indexes = await collection.indexes();
    } catch (err) {
      // NamespaceNotFound — the collection does not exist yet, so there is
      // nothing obsolete to drop and the first insert will create it cleanly.
      if (err.codeName === 'NamespaceNotFound' || err.code === 26) return;
      throw err;
    }

    for (const name of OBSOLETE) {
      const existing = indexes.find((i) => i.name === name);
      if (!existing) continue;
      // the replacement is partial; if this one already is, it IS the
      // replacement and must be kept
      if (existing.partialFilterExpression) continue;

      // eslint-disable-next-line no-await-in-loop
      await collection.dropIndex(name);
      logger.info(
        `ulearn-students: dropped obsolete non-partial unique index "${name}" ` +
          '(it made every phone-only account collide on a null value)'
      );
    }
  } catch (err) {
    logger.error(`ulearn-students: could not tidy indexes — ${err.message}`);
  }
};

module.exports = ensureUlearnStudentIndexes;
