const mongoose = require('mongoose');

/**
 * Ids for made-up records.
 *
 * Every record a factory builds gets an id that starts with "5eed". That is the
 * mark that says "this is test data": the models are strict, so a marker field
 * of our own would be dropped on save, but every record has an id.
 *
 * The rest of the id is the kind of record and a counter, so the same call
 * always gives the same id:
 *
 *   5eed 0003 000000000000002a
 *   mark kind counter
 */

const MARK = '5eed';

const KINDS = {
  role: 1,
  user: 2,
  student: 3,
  application: 4,
  document: 5,
  comment: 6,
  note: 7,
  fee: 8,
  lead: 9,
  conversation: 10,
  message: 11,
  university: 12,
  course: 13,
  courseDetail: 14,
};

const hex = (number, width) => number.toString(16).padStart(width, '0');

/** The id of the n-th made-up record of a kind. n starts at 1. */
const seedId = (kind, n) => {
  if (!KINDS[kind]) throw new Error(`seedId: unknown kind "${kind}"`);
  if (!Number.isInteger(n) || n < 1) throw new Error(`seedId: n must be a whole number from 1, got ${n}`);
  return mongoose.Types.ObjectId(`${MARK}${hex(KINDS[kind], 4)}${hex(n, 16)}`);
};

/** Was this id made by seedId? */
const isSeedId = (id) => String(id).toLowerCase().startsWith(MARK);

/** Which kind of record an id made by seedId belongs to, or undefined. */
const kindOfSeedId = (id) => {
  if (!isSeedId(id)) return undefined;
  const code = parseInt(String(id).slice(4, 8), 16);
  return Object.keys(KINDS).find((kind) => KINDS[kind] === code);
};

module.exports = { seedId, isSeedId, kindOfSeedId, KINDS, MARK };
