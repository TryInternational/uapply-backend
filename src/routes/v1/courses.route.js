const express = require('express');

const coursesController = require('../../controllers/courses.controller');

const router = express.Router();

router.post('/', coursesController.createCourse);
// router.post('/:bookingId/sendClassLink', validate(bookingValidation.updateBooking), coursesController.sendClassLink);

router.route('/').get(coursesController.getCourses);
// router.route(auth('/getBookingByEmail/:email')).get(coursesController.getBookingByEmail);

router.route('/search/:text').get(coursesController.searchCourses);

router.route('/:courseId').patch(coursesController.updateCourse).delete(coursesController.deleteCourse);

router.route('/:courseId').get(coursesController.getCourse);

// router.post('/confirm', coursesController.confirm);
// router.post('/execute', coursesController.execute);

module.exports = router;

/**
 * @swagger
 * tags:
 *   name: Booking
 *   description: Booking
 */

/**
 * @swagger
 * path:
 *  /booking/initiate:
 *    post:
 *      summary: Register as user
 *      tags: [Auth]
 *      requestBody:
 *        required: true
 *        content:
 *          application/json:
 *            schema:
 *              type: object
 *              required:
 *                - name
 *                - email
 *                - password
 *              properties:
 *                name:
 *                  type: string
 *                email:
 *                  type: string
 *                  format: email
 *                  description: must be unique
 *                password:
 *                  type: string
 *                  format: password
 *                  minLength: 8
 *                  description: At least one number and one letter
 *              example:
 *                name: fake name
 *                email: fake@example.com
 *                password: password1
 *      responses:
 *        "201":
 *          description: Created
 *          content:
 *            application/json:
 *              schema:
 *                type: object
 *                properties:
 *                  user:
 *                    $ref: '#/components/schemas/User'
 *                  tokens:
 *                    $ref: '#/components/schemas/AuthTokens'
 *        "400":
 *          $ref: '#/components/responses/DuplicateEmail'
 */

/**
 * @swagger
 * path:
 *  /auth/login:
 *    post:
 *      summary: Login
 *      tags: [Auth]
 *      requestBody:
 *        required: true
 *        content:
 *          application/json:
 *            schema:
 *              type: object
 *              required:
 *                - email
 *                - password
 *              properties:
 *                email:
 *                  type: string
 *                  format: email
 *                password:
 *                  type: string
 *                  format: password
 *              example:
 *                email: fake@example.com
 *                password: password1
 *      responses:
 *        "200":
 *          description: OK
 *          content:
 *            application/json:
 *              schema:
 *                type: object
 *                properties:
 *                  user:
 *                    $ref: '#/components/schemas/User'
 *                  tokens:
 *                    $ref: '#/components/schemas/AuthTokens'
 *        "401":
 *          description: Invalid email or password
 *          content:
 *            application/json:
 *              schema:
 *                $ref: '#/components/schemas/Error'
 *              example:
 *                code: 401
 *                message: Invalid email or password
 */

/**
 * @swagger
 * path:
 *  /auth/refresh-tokens:
 *    post:
 *      summary: Refresh auth tokens
 *      tags: [Auth]
 *      requestBody:
 *        required: true
 *        content:
 *          application/json:
 *            schema:
 *              type: object
 *              required:
 *                - refreshToken
 *              properties:
 *                refreshToken:
 *                  type: string
 *              example:
 *                refreshToken: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI1ZWJhYzUzNDk1NGI1NDEzOTgwNmMxMTIiLCJpYXQiOjE1ODkyOTg0ODQsImV4cCI6MTU4OTMwMDI4NH0.m1U63blB0MLej_WfB7yC2FTMnCziif9X8yzwDEfJXAg
 *      responses:
 *        "200":
 *          description: OK
 *          content:
 *            application/json:
 *              schema:
 *                $ref: '#/components/schemas/AuthTokens'
 *        "401":
 *          $ref: '#/components/responses/Unauthorized'
 */

/**
 * @swagger
 * path:
 *  /auth/forgot-password:
 *    post:
 *      summary: Forgot password
 *      description: An email will be sent to reset password.
 *      tags: [Auth]
 *      requestBody:
 *        required: true
 *        content:
 *          application/json:
 *            schema:
 *              type: object
 *              required:
 *                - email
 *              properties:
 *                email:
 *                  type: string
 *                  format: email
 *              example:
 *                email: fake@example.com
 *      responses:
 *        "204":
 *          description: No content
 *        "404":
 *          $ref: '#/components/responses/NotFound'
 */

/**
 * @swagger
 * path:
 *  /auth/reset-password:
 *    post:
 *      summary: Reset password
 *      tags: [Auth]
 *      parameters:
 *        - in: query
 *          name: token
 *          required: true
 *          schema:
 *            type: string
 *          description: The reset password token
 *      requestBody:
 *        required: true
 *        content:
 *          application/json:
 *            schema:
 *              type: object
 *              required:
 *                - password
 *              properties:
 *                password:
 *                  type: string
 *                  format: password
 *                  minLength: 8
 *                  description: At least one number and one letter
 *              example:
 *                password: password1
 *      responses:
 *        "204":
 *          description: No content
 *        "401":
 *          description: Password reset failed
 *          content:
 *            application/json:
 *              schema:
 *                $ref: '#/components/schemas/Error'
 *              example:
 *                code: 401
 *                message: Password reset failed
 */
