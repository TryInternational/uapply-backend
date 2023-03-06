const express = require('express');

const courseLevelController = require('../../controllers/courseLevel.controller');

const router = express.Router();

router.post('/', courseLevelController.createCourseLevel);

router.route('/').get(courseLevelController.getCourseLevels);
// router.route(auth('/getBookingByEmail/:email')).get(coursesController.getBookingByEmail);

router.route('/search/:text').get(courseLevelController.searchCourseLevels);

router
  .route('/:courseLevelId')
  .patch(courseLevelController.updateCourseLevel)
  .delete(courseLevelController.deleteCourseLevel);

router.route('/:courseLevelId').get(courseLevelController.getCourseLevel);

// router.post('/confirm', coursesController.confirm);
// router.post('/execute', coursesController.execute);

module.exports = router;
