const express = require('express');

const commentsController = require('../../controllers/comments.controller');

const { softAuth, scopeSubAgentToOwnStudent } = require('../../middlewares/subAgentScope');

const router = express.Router();

// A sub-agent may reach these only for a student it owns; see
// scopeSubAgentToOwnStudent. softAuth only identifies the caller, so behaviour
// for every other role is unchanged.
router.use(softAuth, scopeSubAgentToOwnStudent);

router.route('/').post(commentsController.createComment);

router.route('/').get(commentsController.getComments);

// router.route('/search/:text').get(commentsController.searchCountries);
router.post('/migrate-reactions', commentsController.migrateReactions);
router.route('/:commentId').patch(commentsController.updateComment).delete(commentsController.deleteComment);
router.post('/:commentId/tag', commentsController.tagUserInComment);

router.route('/:commentId').get(commentsController.getComment);
router.route('/student/:studentId').get(commentsController.getCommentByStudentId);

module.exports = router;
