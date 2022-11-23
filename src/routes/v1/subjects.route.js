const express = require('express');

const subjectsController = require('../../controllers/subjects.controller');

const router = express.Router();

router.post('/', subjectsController.createSubject);
// router.post('/:bookingId/sendClassLink', validate(bookingValidation.updateBooking), subjectsController.sendClassLink);

router.route('/').get(subjectsController.getSubjects);
// router.route(auth('/getBookingByEmail/:email')).get(subjectsController.getBookingByEmail);

router.route('/search/:text').get(subjectsController.searchSubjects);

router.route('/:subjectId').patch(subjectsController.updateSubject).delete(subjectsController.deleteSubject);

router.route('/:subjectId').get(subjectsController.getSubject);

// router.post('/confirm', subjectsController.confirm);
// router.post('/execute', subjectsController.execute);

module.exports = router;
