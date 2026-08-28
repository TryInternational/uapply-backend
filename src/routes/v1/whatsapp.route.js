const express = require('express');
const multer = require('multer');
const auth = require('../../middlewares/auth');
const validate = require('../../middlewares/validate');
const whatsappValidation = require('../../validations/whatsapp.validation');
const whatsappController = require('../../controllers/whatsapp.controller');

const router = express.Router();

// In-memory upload for the one multipart endpoint; the buffer is streamed on to
// storage/Meta immediately (nothing is written to disk).
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 16 * 1024 * 1024 } });

// Public webhook — Meta calls these; authenticated by the verify token / signature.
router.route('/webhook').get(whatsappController.verifyWebhook).post(whatsappController.receiveWebhook);

router.route('/integration').get(auth(), whatsappController.getIntegration);
router
  .route('/analytics/overview')
  .get(auth(), validate(whatsappValidation.analytics), whatsappController.getOverviewAnalytics);
router.route('/analytics/team').get(auth(), validate(whatsappValidation.analytics), whatsappController.getTeamAnalytics);
router.route('/templates').get(auth(), whatsappController.getTemplates);
router.route('/media').post(auth(), upload.single('file'), whatsappController.uploadMedia);

router
  .route('/conversations')
  .get(auth(), validate(whatsappValidation.getConversations), whatsappController.getConversations);
router
  .route('/conversations/:id')
  .get(auth(), validate(whatsappValidation.conversationId), whatsappController.getConversation)
  .patch(auth(), validate(whatsappValidation.updateMeta), whatsappController.updateMeta);
router.route('/conversations/:id/notes').post(auth(), validate(whatsappValidation.addNote), whatsappController.addNote);
router
  .route('/conversations/:id/messages/voice')
  .post(auth(), upload.single('file'), validate(whatsappValidation.conversationId), whatsappController.sendVoice);
router
  .route('/conversations/:id/read')
  .post(auth(), validate(whatsappValidation.conversationId), whatsappController.markRead);
router.route('/conversations/:id/assign').post(auth(), validate(whatsappValidation.assign), whatsappController.assign);
router
  .route('/conversations/:id/messages')
  .get(auth(), validate(whatsappValidation.listMessages), whatsappController.listMessages);
router
  .route('/conversations/:id/messages/text')
  .post(auth(), validate(whatsappValidation.sendText), whatsappController.sendText);
router
  .route('/conversations/:id/messages/template')
  .post(auth(), validate(whatsappValidation.sendTemplate), whatsappController.sendTemplate);
router
  .route('/conversations/:id/messages/media')
  .post(auth(), validate(whatsappValidation.sendMedia), whatsappController.sendMedia);

module.exports = router;
