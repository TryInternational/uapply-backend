const express = require('express');

const documentsController = require('../../controllers/documents.controller');

const {
  softAuth,
  scopeSubAgentToOwnStudent,
  requireAuth,
  requireSchoolCounselor,
  isExternalPartner,
} = require('../../middlewares/subAgentScope');
const ApiError = require('../../utils/ApiError');
const httpStatus = require('http-status');

const router = express.Router();

// Passport MRZ extraction.
//
// Mounted ABOVE the pathless router.use below, on purpose: that middleware is
// scopeSubAgentToOwnStudent, which demands a studentId for any external partner
// and 403s ("A student must be specified") when it cannot find one. This
// endpoint addresses a FILE, not a student, so running it through that gate
// would reject every school counsellor. It carries its own, stricter gate
// instead — requireAuth (a real token, not softAuth's pass-through) plus
// requireSchoolCounselor.
//
// School-counsellor-only by decision: sharing it with the sub-agent portal
// would change sub-agent behaviour, which is out of scope.
router
  .route('/passport-extract')
  .post(requireAuth, requireSchoolCounselor, documentsController.extractPassportFields);

// A sub-agent may reach these only for a student it owns; see
// scopeSubAgentToOwnStudent. softAuth only identifies the caller, so behaviour
// for every other role is unchanged.
/**
 * For partner requests addressed to a DOCUMENT (/:documentId), the ownership
 * gate below needs a student id — but the request carries none, so it would
 * 403 with "A student must be specified". Resolve the id from the document
 * itself and OVERWRITE anything the client sent: the document's own record is
 * the truth about which student it belongs to. Without the overwrite a partner
 * could delete any document at all by naming one of their own students in the
 * query string — the gate checks that the caller owns the named student, not
 * that the document does.
 */
const resolveDocumentStudent = async (req, res, next) => {
  if (!isExternalPartner(req.user)) return next();
  const m = /^\/([0-9a-f]{24})$/i.exec(req.path || '');
  if (!m) return next();
  // Ownership makes GET and DELETE legitimate for a partner; PATCH is a
  // different matter — docState (Received/Verified/Rejected) is the staff
  // verdict on a document, and resolving the student here would otherwise
  // quietly open it up. Partners re-upload rather than edit.
  if (req.method === 'PATCH') {
    return next(new ApiError(httpStatus.FORBIDDEN, 'Documents can only be updated by the Ulearn team'));
  }
  try {
    // eslint-disable-next-line global-require
    const { Documents } = require('../../models');
    const doc = await Documents.findById(m[1]).select('studentId');
    if (!doc || !doc.studentId) {
      return next(new ApiError(httpStatus.NOT_FOUND, 'Document not found'));
    }
    req.query.studentId = String(doc.studentId._id || doc.studentId);
    return next();
  } catch (err) {
    return next(new ApiError(httpStatus.NOT_FOUND, 'Document not found'));
  }
};

router.use(softAuth, resolveDocumentStudent, scopeSubAgentToOwnStudent);

router.route('/').post(documentsController.createDocument);
router.route('/').get(documentsController.getDocuments);

router.route('/:documentId').patch(documentsController.updateDocument).delete(documentsController.deleteDocument);

router.route('/:documentId').get(documentsController.getDocument);
router.route('/student/:studentId').get(documentsController.getDocumentByStudentId);

module.exports = router;
