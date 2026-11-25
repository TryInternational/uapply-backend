const express = require('express');

const commentsController = require('../../controllers/comments.controller');

const { softAuth, scopeSubAgentToOwnStudent, resolveRecordStudent } = require('../../middlewares/subAgentScope');

const router = express.Router();

// A partner may reach these only for a student it owns; see
// scopeSubAgentToOwnStudent. For a request about one comment by its id, the
// student that is checked is the one the comment belongs to, not one the
// request names; see resolveRecordStudent. softAuth only identifies the
// caller, so behaviour for every other role is unchanged.
router.use(softAuth, resolveRecordStudent('Comments', 'studentId'), scopeSubAgentToOwnStudent);

router.route('/').post(commentsController.createComment);

router.route('/').get(commentsController.getComments);

// router.route('/search/:text').get(commentsController.searchCountries);
router.post('/migrate-reactions', commentsController.migrateReactions);
router.route('/:commentId').patch(commentsController.updateComment).delete(commentsController.deleteComment);
router.post('/:commentId/tag', commentsController.tagUserInComment);

router.route('/:commentId').get(commentsController.getComment);
router.route('/student/:studentId').get(commentsController.getCommentByStudentId);

module.exports = router;
