const express = require('express');
const validate = require('../../middlewares/validate');
const emailController = require('../../controllers/email.controller');
const auth = require('../../middlewares/auth');
const Joi = require('joi');

const router = express.Router();

// Validation schemas
const sendEmailTemplateValidation = {
  body: Joi.object().keys({
    to: Joi.string().email().required(),
    subject: Joi.string().required(),
    templateName: Joi.string().required(),
    context: Joi.object().optional(),
    text: Joi.string().optional(),
  }),
};

const sendEmailWithHTMLValidation = {
  body: Joi.object().keys({
    to: Joi.string().email().required(),
    subject: Joi.string().required(),
    htmlContent: Joi.string().required(),
    context: Joi.object().optional(),
    text: Joi.string().optional(),
  }),
};

const sendIeltsReminderValidation = {
  body: Joi.object().keys({
    to: Joi.string().email().required(),
    eventDetails: Joi.object().keys({
      name: Joi.string().optional(),
      date: Joi.string().optional(),
      time: Joi.string().optional(),
      location: Joi.string().optional(),
    }).required(),
  }),
};

// Routes
router.post('/send-template', validate(sendEmailTemplateValidation), emailController.sendEmailTemplate);
router.post('/send-html', validate(sendEmailWithHTMLValidation), emailController.sendEmailWithHTML);
router.get('/templates', emailController.getAvailableTemplates);
router.post('/send-ielts-reminder', validate(sendIeltsReminderValidation), emailController.sendIeltsReminder);

module.exports = router;

/**
 * @swagger
 * tags:
 *   name: Email
 *   description: Email management and template sending
 */

/**
 * @swagger
 * /email/send-template:
 *   post:
 *     summary: Send email using a template
 *     tags: [Email]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - to
 *               - subject
 *               - templateName
 *             properties:
 *               to:
 *                 type: string
 *                 format: email
 *                 description: Recipient email address
 *               subject:
 *                 type: string
 *                 description: Email subject
 *               templateName:
 *                 type: string
 *                 description: Name of the template file (without extension)
 *               context:
 *                 type: object
 *                 description: Variables to be used in the template
 *               text:
 *                 type: string
 *                 description: Plain text version of the email
 *             example:
 *               to: user@example.com
 *               subject: Welcome to our platform
 *               templateName: welcome
 *               context:
 *                 name: John Doe
 *                 loginUrl: https://example.com/login
 *     responses:
 *       "200":
 *         description: Email sent successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Email sent successfully
 *       "400":
 *         description: Bad request - missing required fields
 *       "500":
 *         description: Internal server error
 */

/**
 * @swagger
 * /email/send-html:
 *   post:
 *     summary: Send email with custom HTML content
 *     tags: [Email]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - to
 *               - subject
 *               - htmlContent
 *             properties:
 *               to:
 *                 type: string
 *                 format: email
 *                 description: Recipient email address
 *               subject:
 *                 type: string
 *                 description: Email subject
 *               htmlContent:
 *                 type: string
 *                 description: HTML content of the email
 *               context:
 *                 type: object
 *                 description: Variables to be used in the HTML template
 *               text:
 *                 type: string
 *                 description: Plain text version of the email
 *             example:
 *               to: user@example.com
 *               subject: Custom Email
 *               htmlContent: "<h1>Hello {{name}}</h1><p>Welcome to our platform!</p>"
 *               context:
 *                 name: John Doe
 *     responses:
 *       "200":
 *         description: Email sent successfully
 *       "400":
 *         description: Bad request - missing required fields
 *       "500":
 *         description: Internal server error
 */

/**
 * @swagger
 * /email/templates:
 *   get:
 *     summary: Get list of available email templates
 *     tags: [Email]
 *     responses:
 *       "200":
 *         description: List of available templates
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 templates:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       name:
 *                         type: string
 *                         description: Template name (without extension)
 *                       filename:
 *                         type: string
 *                         description: Full filename
 *                       type:
 *                         type: string
 *                         description: Template type (handlebars or html)
 *       "500":
 *         description: Internal server error
 */

/**
 * @swagger
 * /email/send-ielts-reminder:
 *   post:
 *     summary: Send IELTS event reminder email
 *     tags: [Email]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - to
 *               - eventDetails
 *             properties:
 *               to:
 *                 type: string
 *                 format: email
 *                 description: Recipient email address
 *               eventDetails:
 *                 type: object
 *                 properties:
 *                   name:
 *                     type: string
 *                     description: Participant name
 *                   date:
 *                     type: string
 *                     description: Event date
 *                   time:
 *                     type: string
 *                     description: Event time
 *                   location:
 *                     type: string
 *                     description: Event location
 *             example:
 *               to: student@example.com
 *               eventDetails:
 *                 name: أحمد محمد
 *                 date: 2024-01-15
 *                 time: 10:30 AM
 *                 location: مركز التدريب الرئيسي
 *     responses:
 *       "200":
 *         description: IELTS reminder email sent successfully
 *       "400":
 *         description: Bad request - missing required fields
 *       "500":
 *         description: Internal server error
 */
