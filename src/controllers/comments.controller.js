/* eslint-disable no-return-assign */
/* eslint-disable eqeqeq */
/* eslint-disable array-callback-return */
const httpStatus = require('http-status');
const { pick } = require('lodash');

const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');

const { commentsService } = require('../services');

const createComment = catchAsync(async (req, res) => {
  const comment = await commentsService.createComments(req.body);

  res.status(httpStatus.CREATED).send(comment);
});

const getComments = catchAsync(async (req, res) => {
  // await publishMessage();
  const filter = pick(req.query, ['name', 'code']);
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'populate']);
  const result = await commentsService.queryComments(filter, options);
  res.send(result);
});

const getComment = catchAsync(async (req, res) => {
  const comment = await commentsService.getCommentById(req.params.commentId);

  if (!comment) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Comment not found');
  }
  res.send(comment);
});

const getCommentByStudentId = catchAsync(async (req, res) => {
  const comment = await commentsService.getCommentByStudentId(req.params.studentId);

  if (!comment) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Comment not found');
  }
  res.send(comment);
});

const updateComment = catchAsync(async (req, res) => {
  const comment = await commentsService.updateCommentById(req.params.commentId, req.body);

  res.send(comment);
});

const deleteComment = catchAsync(async (req, res) => {
  await commentsService.deleteCommentById(req.params.commentId);
  res.status(httpStatus.NO_CONTENT).send();
});

// const searchComments = catchAsync(async (req, res) => {
//   // const filter = pick(req.query, ['name', 'status', 'stage']);
//   const options = pick(req.query, ['sortBy', 'limit', 'page', 'populate']);
//   const results = await commentsService.searchComments(req.params.text, options);
//   res.status(200).send(results);
// });

module.exports = {
  createComment,
  getComment,
  getComments,
  deleteComment,
  updateComment,
  getCommentByStudentId,
  //   searchComments,
};
