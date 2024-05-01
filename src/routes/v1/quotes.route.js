const express = require('express');
const auth = require('../../middlewares/auth');
const quotesController = require('../../controllers/quotes.controller');

const router = express.Router();

router.route('/').post(quotesController.createQuotes);
router.route('/').get(quotesController.getQuotes);

router.route('/:id').patch(quotesController.updateQuotes).delete(quotesController.deleteQuote);

router.route('/:id').get(quotesController.getQuote);

module.exports = router;
