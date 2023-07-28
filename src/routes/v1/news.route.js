const express = require('express');
const auth = require('../../middlewares/auth');
const newsController = require('../../controllers/news.controller');

const router = express.Router();

router.route('/').post(newsController.createNews);
router.route('/').get(newsController.getNews);

router
  .route('/:id')
  .patch(auth('manageRoles'), newsController.updateNews)
  .delete(auth('manageRoles'), newsController.deleteNews);

router.route('/:id').get(newsController.getNewsById);

module.exports = router;
