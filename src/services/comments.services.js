const httpStatus = require('http-status');
const { Comments } = require('../models');
const ApiError = require('../utils/ApiError');

/**
 * Create a booking
 * @param {Object} commentBody
 * @returns {Promise<Comment>}
 */
const createComments = async (commentBody) => {
  const comment = await Comments.create(commentBody);
  return comment;
};

/**
 * Query for bookings
 * @param {Object} _filter - Mongo filter
 * @param {Object} options - Query options
 * @param {string} [options.sortBy] - Sort option in the format: sortField:(desc|asc)
 * @param {number} [options.limit] - Maximum number of results per page (default = 10)
 * @param {number} [options.page] - Current page (default = 1)
 * @returns {Promise<QueryResult>}
 */
const queryComments = async (filter, options) => {
  const comment = await Comments.paginate(filter, options);
  return comment;
};

/**
 * @param {ObjectId} id
 * @returns {Promise<User>}
 */
const getCommentById = async (id) => {
  return Comments.findById(id);
};

const getCommentByStudentId = async (studentId) => {
  return Comments.find({ studentId });
};

/**
 * Update booking by id
 * @param {ObjectId} id
 * @param {Object} updateBody
 * @returns {Promise<User>}
 */
const updateCommentById = async (id, updateBody) => {
  const comment = await getCommentById(id);
  if (!comment) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Comment not found');
  }
  Object.assign(comment, updateBody);
  await comment.save();
  return comment;
};

/**
 * Delete booking by id
 * @param {ObjectId} commentId
 * @returns {Promise<User>}
 */
const deleteCommentById = async (commentId) => {
  const comment = await getCommentById(commentId);
  if (!comment) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Comment not found');
  }
  await comment.remove();
  return comment;
};

/**
 * Delete booking by id
 * @param {ObjectId} commentId
 * @param {Object} commentBody
 * @returns {Promise<Comment>}
 */

// const searchComment = async (text, options) => {
//   // eslint-disable-next-line security/detect-non-literal-regexp
//   const regex = new RegExp(text, 'i');
//   const comment = await Comments.paginate({ $or: [{ english_name: regex }, { arabic_name: regex }] }, options);
//   return comment;
// };

/**
 * Migrate old reaction format to new format
 * @returns {Promise<Object>} migration result
 */ const migrateReactions = async () => {
  try {
    console.log('Starting reactions migration...');

    // 1. First verify pre-migration state
    const preMigrationStats = {
      totalComments: await Comments.countDocuments(),
      oldStringFormat: await Comments.countDocuments({ reactions: { $type: 'string' } }),
      hasReactedBy: await Comments.countDocuments({ reactedBy: { $exists: true } }),
      emptyReactions: await Comments.countDocuments({ reactions: { $exists: false } }),
      emptyArray: await Comments.countDocuments({ reactions: { $eq: [] } }),
    };
    console.log('Pre-migration stats:', preMigrationStats);

    // 2. Execute migration in batches for safety
    const BATCH_SIZE = 500;
    let migratedCount = 0;
    let skippedCount = 0;
    let lastProcessedId = null;
    let hasMore = true;

    while (hasMore) {
      const query = {};
      if (lastProcessedId) {
        query._id = { $gt: lastProcessedId };
      }

      const comments = await Comments.find({
        ...query,
        $or: [
          { reactions: { $type: 'string' } },
          { reactedBy: { $exists: true } },
          { reactions: { $exists: false } },
          { reactions: { $eq: [] } },
        ],
      })
        .sort({ _id: 1 })
        .limit(BATCH_SIZE)
        .lean();

      if (comments.length === 0) {
        hasMore = false;
        break;
      }

      const bulkOps = comments.map((comment) => {
        let newReactions = [];

        // Determine migration case
        if (typeof comment.reactions === 'string' && comment.reactions) {
          newReactions = [
            {
              emoji: comment.reactions,
              users: comment.reactedBy
                ? [
                    {
                      userId: comment.userId?._id || comment.userId,
                      name: comment.reactedBy,
                    },
                  ]
                : [],
            },
          ];
        } else if (comment.reactedBy) {
          newReactions = [
            {
              emoji: '👍',
              users: [
                {
                  userId: comment.userId?._id || comment.userId,
                  name: comment.reactedBy,
                },
              ],
            },
          ];
        } else {
          newReactions = [];
        }

        return {
          updateOne: {
            filter: { _id: comment._id },
            update: {
              $set: { reactions: newReactions },
              $unset: { reactedBy: '' },
            },
          },
        };
      });

      // Execute bulk operation
      const result = await Comments.bulkWrite(bulkOps);
      migratedCount += result.modifiedCount;
      lastProcessedId = comments[comments.length - 1]._id;

      console.log(`Processed batch up to ${lastProcessedId}. Migrated ${result.modifiedCount} in this batch.`);
    }

    // 3. Verify post-migration state
    const postMigrationStats = {
      newFormatCount: await Comments.countDocuments({ 'reactions.0': { $exists: true } }),
      oldStringRemaining: await Comments.countDocuments({ reactions: { $type: 'string' } }),
      reactedByRemaining: await Comments.countDocuments({ reactedBy: { $exists: true } }),
    };
    console.log('Post-migration stats:', postMigrationStats);

    return {
      success: true,
      message: `Reactions migration completed. ${migratedCount} comments migrated.`,
      preMigrationStats,
      postMigrationStats,
      anyRemainingOldFormat: postMigrationStats.oldStringRemaining > 0 || postMigrationStats.reactedByRemaining > 0,
    };
  } catch (error) {
    console.error('Migration error:', error);
    return {
      success: false,
      message: 'Migration failed',
      error: error.message,
    };
  }
};
module.exports = {
  createComments,
  queryComments,
  getCommentById,
  updateCommentById,
  deleteCommentById,
  //   searchComment,
  getCommentByStudentId,
  migrateReactions,
};
