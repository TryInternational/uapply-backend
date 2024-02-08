const express = require('express');

const feesController = require('../../controllers/fees.controller');

const router = express.Router();
router.route('/').post(feesController.createFees);

router.route('/').get(feesController.getFees);

router.route('/months').get(feesController.getAmountPermonth);

router.route('/:id').patch(feesController.updateFees).delete(feesController.deleteFees);

router.route('/:id').get(feesController.getFeesById);

module.exports = router;
