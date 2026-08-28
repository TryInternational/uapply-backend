const mongoose = require('mongoose');
const logger = require('../config/logger');
const { Activity } = require('../models');

const createActivity = async (body) => Activity.create(body);

// Per-student timeline, newest first. Paginated ("load more" on the client).
const getActivitiesByStudentId = async (studentId, { limit, page, types } = {}) => {
  const perPage = limit && parseInt(limit, 10) > 0 ? parseInt(limit, 10) : 30;
  const currentPage = page && parseInt(page, 10) > 0 ? parseInt(page, 10) : 1;
  const skip = (currentPage - 1) * perPage;

  const filter = { student: studentId };
  // Optional restriction to a set of activity types — used to keep internal
  // operational entries out of the partner-facing timeline.
  if (Array.isArray(types) && types.length) filter.type = { $in: types };
  const [totalResults, results] = await Promise.all([
    Activity.countDocuments(filter),
    Activity.find(filter).sort({ createdAt: -1 }).skip(skip).limit(perPage),
  ]);

  return {
    results,
    page: currentPage,
    limit: perPage,
    totalPages: Math.ceil(totalResults / perPage),
    totalResults,
  };
};

/**
 * Fire-and-forget timeline write for use inside other controllers' auto-log
 * hooks. NEVER throws and never rejects — an activity-write failure must not
 * fail (or delay a rejection into) the parent request. Skips silently when no
 * studentId/type/text is available.
 *
 * @param {Object} entry - { student, type, text, actorId, actorName, meta }
 * @returns {Promise<Activity|null>}
 */
const logActivity = async (entry) => {
  try {
    if (!entry || !entry.student || !entry.type || !entry.text) return null;
    if (!mongoose.isValidObjectId(entry.student)) return null;
    const doc = { ...entry };
    // actorId is often supplied from a request body (frontend "editor"); drop it
    // if it isn't a real ObjectId so a bad value doesn't discard the whole event.
    if (doc.actorId && !mongoose.isValidObjectId(doc.actorId)) delete doc.actorId;
    return await Activity.create(doc);
  } catch (err) {
    // Non-fatal: log and continue so the parent request still succeeds.
    logger.error('Activity log failed:', err.message);
    return null;
  }
};

module.exports = {
  createActivity,
  getActivitiesByStudentId,
  logActivity,
};
