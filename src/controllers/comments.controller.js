/* eslint-disable no-console */
/* eslint-disable no-return-assign */
/* eslint-disable eqeqeq */
/* eslint-disable array-callback-return */
const httpStatus = require('http-status');
const { pick } = require('lodash');

const axios = require('axios');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');

const { commentsService, userService } = require('../services');
const { getStudentById } = require('../services/students.service');

const tagUserInComment = catchAsync(async (commentId, userIdToTag, res) => {
  try {
    const comment = await commentsService.getCommentById(commentId);

    if (!comment) {
      return res.status(404).json({ success: false, message: 'Comment not found' });
    }

    const userToTag = await userService.getUserById(userIdToTag);

    if (!userToTag) {
      return res.status(404).json({ success: false, message: 'User to tag not found' });
    }

    if (comment.taggedUsers.includes(userToTag._id)) {
      return res.status(400).json({ success: false, message: 'User is already tagged' });
    }

    comment.taggedUsers.push(userToTag._id);
    await comment.save();
    return res.status(200).json({ success: true, message: 'User tagged successfully' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});

const createComment = catchAsync(async (req, res) => {
  const commentData = await commentsService.createComments(req.body);
  const SLACK_API_URL = 'https://slack.com/api/chat.postMessage';
  const SLACK_TOKEN = process.env.SLACK_NOTIFICATION;

  const stdnt = await getStudentById(commentData.studentId);
  const sendSlackNotification = async (memberId, text, comment, student) => {
    try {
      const response = await axios.post(
        SLACK_API_URL,
        {
          channel: memberId,
          blocks: [
            {
              type: 'header',
              text: {
                type: 'plain_text',
                text: `${comment.createdBy} tagged on ${student.firstName}`,
              },
              block_id: 'header',
            },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text,
              },

              block_id: 'section',
              fields: [
                {
                  type: 'mrkdwn',
                  text: `*Phone No:*\n${student.phoneNo}`,
                },
                {
                  type: 'mrkdwn',
                  text: `*Email:*\n${student.email}`,
                },
              ],
            },
          ],
        },
        {
          headers: {
            Authorization: `Bearer ${SLACK_TOKEN}`,
            'Content-Type': 'application/json',
          },
        }
      );
      if (response.data.ok) {
        console.log('Slack notification sent successfully.');
      } else {
        console.error('Error sending Slack notification:', response.data.error);
      }
    } catch (error) {
      console.error('Error sending Slack notification:', error.message);
    }
  };
  if (req.body.mentions.length) {
    req.body.mentions.map(async (z) => {
      tagUserInComment(commentData._id, z.id);

      // if (process.env.APP_ENV === 'production') {
      // await axios(Tryslack);
      sendSlackNotification(z.memberId, commentData.content, commentData, stdnt);
      // }
    });
  }
  res.status(httpStatus.CREATED).send(commentData);
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
  tagUserInComment,
  //   searchComments,
};
