const express = require('express');
const paymentController = require('../../controllers/payment.controller');
const paymentValidation = require('../../validations/payment.validation');
const auth = require('../../middlewares/auth');
const validate = require('../../middlewares/validate');

const router = express.Router();

router.get('/get-payment-methods', paymentController.getPaymentMethods);
router.get('/redirect/confirm', paymentController.confirm);

router.route('/:paymentId').get(paymentController.getPayment);

router
  .route('/:paymentId/make-refund')
  .post(auth('managePayments'), validate(paymentValidation.requestRefund), paymentController.requestRefund);
router.get('/redirect/error', paymentController.error);
// router.post('/confirm', paymentController.confirm);
// router.post('/execute', paymentController.execute);

module.exports = router;
