const express = require('express');

const commentsController = require('../../controllers/comments.controller');

const router = express.Router();

router.route('/').post(commentsController.createComment);

router.route('/').get(commentsController.getComments);

// router.route('/search/:text').get(commentsController.searchCountries);

router.route('/:countryId').patch(commentsController.updateComment).delete(commentsController.deleteComment);
router.post('/:commentId/tag', commentsController.tagUserInComment);

router.route('/:countryId').get(commentsController.getComment);
router.route('/student/:studentId').get(commentsController.getCommentByStudentId);

module.exports = router;
