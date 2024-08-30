const express = require('express');

const ambassadorsController = require('../../controllers/ambassadors.controller');

const router = express.Router();

router.route('/').post(ambassadorsController.createAmbassador);
router.route('/').get(ambassadorsController.getAmbassadors);

router.route('/:ambassadorId').patch(ambassadorsController.updateAmbassador).delete(ambassadorsController.deleteAmbassador);

router.route('/:ambassadorId').get(ambassadorsController.getAmbassador);

module.exports = router;
