const express = require('express');

const documentsController = require('../../controllers/documents.controller');

const router = express.Router();

router.route('/').post(documentsController.createDocument);
router.route('/').get(documentsController.getDocuments);

router.route('/:documentId').patch(documentsController.updateDocument).delete(documentsController.deleteDocument);

router.route('/:documentId').get(documentsController.getDocument);
router.route('/student/:studentId').get(documentsController.getDocumentByStudentId);

module.exports = router;
