/* eslint-disable no-console */
/* eslint-disable no-return-assign */
/* eslint-disable eqeqeq */
/* eslint-disable array-callback-return */
const httpStatus = require('http-status');
const { pick } = require('lodash');
const axios = require('axios');
const he = require('he'); // Library to decode HTML entities

const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');

const { commentsService, userService, notificationsService } = require('../services');
const { getStudentById } = require('../services/students.service');

// Helper function to strip HTML tags and decode entities
const stripHtml = (html) => {
  if (!html) return ''; // Handle null or undefined input
  const decodedText = he.decode(html); // Decode HTML entities
  return decodedText
    .replace(/<[^>]+>/g, '') // Remove all HTML tags
    .trim(); // Remove leading/trailing whitespace
};

// Helper function to tag a user in a comment
const tagUserInComment = catchAsync(async (res, commentId, userIdToTag) => {
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
    return res.status(200);
  } catch (error) {
    console.log(error);
  }
});

const createComment = catchAsync(async (req, res) => {
  const commentData = await commentsService.createComments(req.body);
  const SLACK_API_URL = 'https://slack.com/api/chat.postMessage';
  const SLACK_TOKEN = process.env.SLACK_NOTIFICATION;

  const stdnt = await getStudentById(commentData.studentId);

  // Function to send Slack notification
  const sendSlackNotification = async (memberId, text, comment, student) => {
    // Strip HTML tags and decode entities from the comment content
    const plainTextContent = stripHtml(text);

    // Debug: Log the stripped text

    // Get image links from the comment's images array (if it exists)
    const imageLinks = comment.images || [];

    try {
      const response = await axios.post(
        SLACK_API_URL,
        {
          channel: memberId,
          attachments: [
            {
              pretext: `*${comment.createdBy} tagged you on ${student.firstName ? student.firstName : ''} ${
                student.middleName ? student.middleName : ''
              } ${student.lastName ? student.lastName : ''}*`,
              text: plainTextContent, // Use the plain text content here
              color: '#8000FF',
              image_url: imageLinks.length > 0 ? imageLinks[0] : null, // Add the first image link if available
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

  // If there are mentions, tag users and send Slack notifications
  if (req.body.mentions.length) {
    req.body.mentions.map(async (z) => {
      tagUserInComment(res, commentData._id, z.id);

      // if (process.env.APP_ENV === 'production') {
      sendSlackNotification(z.memberId, commentData.content, commentData, stdnt);
      const io = req.app.get('io');

      console.log(commentData.userId.toString(), 'jhgfh');
      await notificationsService.createNotification(
        io,
        [z.id.toString()],
        `${commentData.createdBy} tagged you on ${stdnt.firstName ? stdnt.firstName : ''} ${
          stdnt.middleName ? stdnt.middleName : ''
        } ${stdnt.lastName ? stdnt.lastName : ''}`,
        'comment',
        stdnt.id,
        commentData._id,
        commentData.userId.toString()
      );
      // }
    });
  }
  res.status(httpStatus.CREATED).send(commentData);
});

// Get all comments
const getComments = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['name', 'code']);
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'populate']);
  const result = await commentsService.queryComments(filter, options);
  res.send(result);
});

// Get a single comment by ID
const getComment = catchAsync(async (req, res) => {
  const comment = await commentsService.getCommentById(req.params.commentId);

  if (!comment) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Comment not found');
  }
  res.send(comment);
});

// Get comments by student ID
const getCommentByStudentId = catchAsync(async (req, res) => {
  const comment = await commentsService.getCommentByStudentId(req.params.studentId);

  if (!comment) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Comment not found');
  }
  res.send(comment);
});

// Update a comment
const updateComment = catchAsync(async (req, res) => {
  const comment = await commentsService.updateCommentById(req.params.commentId, req.body);

  if (req.body.reactedBy && req.body.reactions) {
    const commentBody = await commentsService.getCommentById(req.params.commentId);

    const user = await userService.getUserById(commentBody.userId);

    // Function to send Slack notification
    const sendSlackNotification = async (memberId, slackBody) => {
      const SLACK_API_URL = 'https://slack.com/api/chat.postMessage';
      const SLACK_TOKEN = process.env.SLACK_NOTIFICATION;
      try {
        const response = await axios.post(
          SLACK_API_URL,
          {
            channel: memberId,
            ...slackBody,
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

    // Strip HTML tags and decode entities from the comment content
    const plainTextContent = stripHtml(commentBody.content || '');

    // Get image links from the comment's images array (if it exists)
    const imageLinks = commentBody.images || [];

    const slackBody = {
      attachments: [
        {
          pretext: `${req.body.reactedBy} reacted "${req.body.reactions}" to your comment \n"${plainTextContent}"`,
          text: ``,
          color: '#FFFF00',
          image_url: imageLinks.length > 0 ? imageLinks[0] : null, // Add the first image link if available
        },
      ],
    };

    // Send Slack notification
    // if (process.env.APP_ENV === 'production') {
    await sendSlackNotification(user.slackMemberId, slackBody);
    const io = req.app.get('io');

    await notificationsService.createNotification(
      io,
      [user._id.toString()],
      slackBody.attachments[0].pretext,
      'comment',
      comment.studentId,
      commentBody._id,
      commentBody.userId.toString()
    );
  }

  res.send(comment);
});

// Delete a comment
const deleteComment = catchAsync(async (req, res) => {
  await commentsService.deleteCommentById(req.params.commentId);
  res.status(httpStatus.NO_CONTENT).send();
});

const migrateReactions = catchAsync(async (req, res) => {
  const result = await commentsService.migrateReactions();
  if (!result.success) {
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, result.message);
  }
  res.send(result);
});
module.exports = {
  createComment,
  getComment,
  getComments,
  deleteComment,
  updateComment,
  getCommentByStudentId,
  tagUserInComment,
  migrateReactions,
};
