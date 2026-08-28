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
const { isExternalPartner } = require('../middlewares/subAgentScope');

// Helper function to strip HTML tags and decode entities
const stripHtml = (html) => {
  if (!html) return ''; // Handle null or undefined input
  const decodedText = he.decode(html); // Decode HTML entities
  return decodedText
    .replace(/<[^>]+>/g, '') // Remove all HTML tags
    .trim(); // Remove leading/trailing whitespace
};

// Tag a user on an EXISTING comment. Reachable on its own route
// (POST /comments/:commentId/tag); createComment no longer calls it.
//
// It used to be invoked from createComment as `tagUserInComment(res, id, uid)`
// — fire-and-forget, with the response object handed to a helper that also
// wrote its own 4xx bodies. Since the client already sends `taggedUsers` in
// the create payload, the comment was saved WITH the tag, this helper then
// found it already there and wrote `400 User is already tagged` onto the same
// response the handler was about to send 201 on. Whichever landed first, the
// other threw ERR_HTTP_HEADERS_SENT. Tagging on create is now done inline.
const tagUserInComment = catchAsync(async (req, res) => {
  const comment = await commentsService.getCommentById(req.params.commentId);
  if (!comment) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Comment not found');
  }
  const userIdToTag = req.body.userId || req.body.id;
  const userToTag = userIdToTag && (await userService.getUserById(userIdToTag));
  if (!userToTag) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User to tag not found');
  }
  // Same rule as createComment: a partner may tag the Ulearn team, never
  // another partner. Unknown/tokenless callers are treated as staff, matching
  // softAuth's pass-through everywhere else.
  if (isExternalPartner(req.user) && isExternalPartner(userToTag)) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Only the Ulearn team can tag another partner');
  }
  const already = (comment.taggedUsers || []).some((u) => String(u) === String(userToTag._id));
  if (!already) {
    comment.taggedUsers.push(userToTag._id);
    await comment.save();
  }
  res.send(comment);
});

// Slack DM for one tagged user. Non-fatal by design: Slack being down or a
// user having no slackMemberId must never fail the comment itself.
const sendTagSlack = async (memberId, comment, student) => {
  const SLACK_API_URL = 'https://slack.com/api/chat.postMessage';
  const SLACK_TOKEN = process.env.SLACK_NOTIFICATION;
  if (!memberId || !SLACK_TOKEN) return;
  const imageLinks = comment.images || [];
  try {
    const response = await axios.post(
      SLACK_API_URL,
      {
        channel: memberId,
        attachments: [
          {
            pretext: `*${comment.createdBy} tagged you on ${student.firstName || ''} ${student.middleName || ''} ${
              student.lastName || ''
            }*`,
            text: stripHtml(comment.content),
            color: '#8000FF',
            image_url: imageLinks.length > 0 ? imageLinks[0] : null,
          },
        ],
      },
      { headers: { Authorization: `Bearer ${SLACK_TOKEN}`, 'Content-Type': 'application/json' } }
    );
    if (!response.data.ok) console.error('Error sending Slack notification:', response.data.error);
  } catch (error) {
    console.error('Error sending Slack notification:', error.message);
  }
};

/**
 * Tell each newly-tagged user, in-app and on Slack.
 *
 * `recipientIds` are user ids already resolved and de-duplicated by the caller;
 * the comment author is never notified about their own tag.
 */
const notifyTagged = async (req, comment, student, recipientIds) => {
  const authorId = comment.userId ? String(comment.userId._id || comment.userId) : '';
  const targets = Array.from(new Set(recipientIds.map(String))).filter((id) => id && id !== authorId);
  if (!targets.length) return;

  const studentName = `${student.firstName || ''} ${student.middleName || ''} ${student.lastName || ''}`
    .replace(/\s+/g, ' ')
    .trim();
  const io = req.app.get('io');

  await Promise.all(
    targets.map(async (id) => {
      try {
        const user = await userService.getUserById(id);
        if (!user) return;
        await sendTagSlack(user.slackMemberId, comment, student);
        await notificationsService.createNotification(
          io,
          [String(id)],
          `${comment.createdBy} tagged you on ${studentName}`,
          'comment',
          student.id,
          comment._id,
          authorId || undefined
        );
      } catch (err) {
        console.error('Tag notification failed:', err.message);
      }
    })
  );
};

/** Mention ids from either payload shape, as plain strings. */
const mentionIdsOf = (body) => {
  const fromMentions = Array.isArray(body.mentions) ? body.mentions.map((m) => m && (m.id || m._id)) : [];
  const fromTagged = Array.isArray(body.taggedUsers) ? body.taggedUsers : [];
  return Array.from(new Set([...fromMentions, ...fromTagged].filter(Boolean).map(String)));
};

/**
 * Vet the requested mentions against who the actor is allowed to tag.
 *
 * Internal staff may tag anyone. A PARTNER may tag only the internal team:
 * the sub-agent portal has shipped @mentions for a while (that is how a
 * partner gets a Ulearn colleague's attention on a thread), so refusing them
 * outright would regress a working feature — but a partner tagging ANOTHER
 * partner would push an internal thread across an organisation boundary, and
 * that is the case worth closing. Unresolvable ids are dropped.
 */
const vetMentions = async (actor, ids) => {
  if (!ids.length) return [];
  const actorIsPartner = isExternalPartner(actor);
  const resolved = await Promise.all(
    ids.map(async (id) => {
      try {
        const user = await userService.getUserById(id);
        if (!user) return null;
        if (actorIsPartner && isExternalPartner(user)) return null;
        return String(user._id);
      } catch (err) {
        return null;
      }
    })
  );
  return resolved.filter(Boolean);
};

const createComment = catchAsync(async (req, res) => {
  const mentionIds = await vetMentions(req.user, mentionIdsOf(req.body));

  const commentData = await commentsService.createComments({
    ...req.body,
    mentions: undefined,
    taggedUsers: mentionIds,
  });

  // Notifications are best-effort: the comment is already saved, and a failure
  // here used to take the whole request down with it. `mentions` being absent
  // did too — `req.body.mentions.length` threw for every caller that does not
  // send the field (the school portal's Messages card), so the message saved
  // and the client still saw a 500.
  if (mentionIds.length) {
    try {
      const student = await getStudentById(commentData.studentId);
      if (student) await notifyTagged(req, commentData, student, mentionIds);
    } catch (err) {
      console.error('Comment tag notifications failed:', err.message);
    }
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
  // Editing a comment can ADD a mention. Resolve who is newly tagged before
  // the update overwrites taggedUsers, so an edit notifies only the people who
  // were not already on the comment.
  const editMentionIds = await vetMentions(req.user, mentionIdsOf(req.body));
  const requestedMentions = mentionIdsOf(req.body).length > 0;
  let freshlyTagged = [];
  if (editMentionIds.length) {
    const before = await commentsService.getCommentById(req.params.commentId);
    const had = new Set(((before && before.taggedUsers) || []).map(String));
    freshlyTagged = editMentionIds.filter((id) => !had.has(String(id)));
  }

  // taggedUsers is never taken from the request as-is — only the vetted list
  // is written, so a hand-crafted PATCH cannot tag someone the actor may not.
  const patch = { ...req.body, mentions: undefined };
  if (requestedMentions) patch.taggedUsers = editMentionIds;
  else delete patch.taggedUsers;

  const comment = await commentsService.updateCommentById(req.params.commentId, patch);

  if (freshlyTagged.length) {
    try {
      const student = await getStudentById(comment.studentId);
      if (student) await notifyTagged(req, comment, student, freshlyTagged);
    } catch (err) {
      console.error('Comment edit tag notifications failed:', err.message);
    }
  }

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
