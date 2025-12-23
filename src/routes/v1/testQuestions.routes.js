const express = require('express');

const testQuestionsController = require('../../controllers/testQuestions.controller');

const router = express.Router();

router.post('/', testQuestionsController.createTestQuestion);
// router.post('/:bookingId/sendClassLink', validate(bookingValidation.updateBooking), subjectsController.sendClassLink);

router.route('/').get(testQuestionsController.getTestQuestions);
// router.route(auth('/getBookingByEmail/:email')).get(subjectsController.getBookingByEmail);

router.route('/search/:text').get(testQuestionsController.searchTestQuestion);

router.route('/section/:section').delete(testQuestionsController.deleteQuestionsBySection);

router.route('/testType/:testType').delete(testQuestionsController.deleteQuestionsByTestType);

router.route('/:id').patch(testQuestionsController.updateTestQuestion).delete(testQuestionsController.deleteTestQuestion);

router.route('/:testType/section/:section?/:lang?').get(testQuestionsController.getQuestionsBySection);

// Get comprehension questions grouped by paragraph
// router.route('/:testType/comprehension/:lang?').get(testQuestionsController.get);

router.route('/:testType/:lang?').get(testQuestionsController.getQuestionsByTestType);

router.route('/:subjectId').get(testQuestionsController.getTestQuestion);

// router.post('/confirm', subjectsController.confirm);
// router.post('/execute', subjectsController.execute);

module.exports = router;
