const express = require('express');

const disciplineController = require('../../controllers/discipline.controller');

const router = express.Router();

router.route('/').post(disciplineController.createDiscipline);
router.route('/').get(disciplineController.getDisciplines);

router.route('/:disciplineId').patch(disciplineController.updateDiscipline).delete(disciplineController.deleteDiscipline);

router.route('/:disciplineId').get(disciplineController.getDiscipline);

module.exports = router;
