const httpStatus = require('http-status');
const { pick } = require('lodash');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');
const { documentsService, activitiesService } = require('../services');
const { actorOf } = require('../utils/actor');
const passportMrzService = require('../services/passportMrz.service');

// studentId may arrive raw or autopopulated — normalise to an id either way.
const studentIdOf = (document) => {
  const s = document && document.studentId;
  if (!s) return null;
  return s._id || s.id || s;
};

const createDocument = catchAsync(async (req, res) => {
  const document = await documentsService.createDocumetns(req.body);

  // Timeline: record the document upload/request (non-fatal).
  const editor = actorOf(req);
  await activitiesService.logActivity({
    student: studentIdOf(document),
    type: 'doc',
    text: `${editor.name} ${
      ['Upload', 'Received', 'Verified'].includes(document.docState) ? 'uploaded' : 'requested'
    } ${
      document.documentType || 'a document'
    }`,
    actorId: editor.id,
    actorName: editor.name,
    meta: { docId: document.id },
  });

  res.status(httpStatus.CREATED).send(document);
});

/**
 * POST /v1/documents/passport-extract  { blobUrl }
 *
 * Reads a passport already uploaded to storage and returns the MRZ-backed
 * fields. Takes a URL rather than a second multipart upload because the client
 * has just put the file in Firebase through the normal document flow — asking
 * for the bytes again would double the transfer for no gain.
 *
 * SSRF: the URL is client-supplied, so the host is checked against an allowlist
 * BEFORE any request is made. Without that, this endpoint would fetch whatever
 * a caller named — cloud metadata endpoints and internal services included.
 * Redirects are not followed for the same reason.
 *
 * Never fails the caller's workflow: a bad scan, a missing OCR binary or a
 * refused URL all come back as ok:false with a reason, and the UI falls back to
 * manual entry.
 */
const ALLOWED_SCAN_HOSTS = new Set(['firebasestorage.googleapis.com', 'storage.googleapis.com']);

/**
 * Is this URL one of our own storage buckets?
 *
 * Newer Firebase projects are provisioned on `<project>.firebasestorage.app`
 * (this one is `ulearn-abroad.firebasestorage.app`), and getDownloadURL can
 * return that host rather than the googleapis one — which the exact-match set
 * above would refuse, failing extraction before a byte was read.
 *
 * The suffix match is bounded to a Google-operated domain, so it cannot be
 * pointed at an internal address; the worst case is fetching a public object
 * from another Firebase project. Everything else is still refused outright,
 * which is what keeps this from being an open SSRF.
 */
const isAllowedScanHost = (hostname) =>
  ALLOWED_SCAN_HOSTS.has(hostname) || /^[a-z0-9-]+(\.[a-z0-9-]+)*\.firebasestorage\.app$/i.test(hostname);
const MAX_SCAN_BYTES = 8 * 1024 * 1024;

const extractPassportFields = catchAsync(async (req, res) => {
  const { blobUrl } = req.body || {};

  let parsed;
  try {
    parsed = new URL(String(blobUrl || ''));
  } catch (err) {
    return res.send({ ok: false, reason: 'INVALID_URL', fields: null });
  }
  if (parsed.protocol !== 'https:' || !isAllowedScanHost(parsed.hostname)) {
    return res.send({ ok: false, reason: 'URL_NOT_ALLOWED', fields: null });
  }

  let buffer;
  try {
    const resp = await fetch(parsed.toString(), { redirect: 'error' });
    if (!resp.ok) return res.send({ ok: false, reason: 'FETCH_FAILED', fields: null });
    const len = Number(resp.headers.get('content-length') || 0);
    if (len > MAX_SCAN_BYTES) return res.send({ ok: false, reason: 'TOO_LARGE', fields: null });
    const arr = await resp.arrayBuffer();
    if (arr.byteLength > MAX_SCAN_BYTES) return res.send({ ok: false, reason: 'TOO_LARGE', fields: null });
    buffer = Buffer.from(arr);
  } catch (err) {
    return res.send({ ok: false, reason: 'FETCH_FAILED', fields: null });
  }

  const result = await passportMrzService.extractPassport(buffer, parsed.pathname);
  return res.send(result);
});

const getDocuments = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['name', 'slug']);
  const options = pick(req.query, ['sortBy', 'limit', 'page', 'populate']);
  const result = await documentsService.queryDocumetns(filter, options);
  res.send(result);
});

const getDocument = catchAsync(async (req, res) => {
  const document = await documentsService.getDocumetnsById(req.params.documentId);
  if (!document) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Document not found');
  }
  res.send(document);
});
const getDocumentByStudentId = catchAsync(async (req, res) => {
  const document = await documentsService.getDocumetnByStudentId(req.params.studentId);
  if (!document) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Document not found');
  }
  res.send(document);
});

const updateDocument = catchAsync(async (req, res) => {
  const document = await documentsService.updateDocumetnsById(req.params.documentId, req.body);

  // Timeline: record the document status change (non-fatal).
  const editor = actorOf(req);
  await activitiesService.logActivity({
    student: studentIdOf(document),
    type: 'doc',
    text: `${editor.name} updated ${document.documentType || 'a document'}`,
    actorId: editor.id,
    actorName: editor.name,
    meta: { docId: document.id },
  });

  res.send(document);
});

const deleteDocument = catchAsync(async (req, res) => {
  // Read it before it goes: the activity line needs the type and the student,
  // and after deletion there is nothing left to ask.
  const document = await documentsService.getDocumetnsById(req.params.documentId).catch(() => null);
  await documentsService.deleteDocumetnById(req.params.documentId);
  if (document) {
    const editor = actorOf(req);
    // "removed Other" tells nobody anything — when the type is the catch-all
    // (or absent), name the actual file instead.
    const typeLabel = document.documentType || document.subType;
    const fileName = document.blobInfo && document.blobInfo[0] && document.blobInfo[0].fileName;
    const what = (typeLabel && typeLabel !== 'Other' ? typeLabel : fileName) || typeLabel || 'a document';
    await activitiesService.logActivity({
      student: studentIdOf(document),
      type: 'doc',
      text: `${editor.name} removed ${what}`,
      actorId: editor.id,
      actorName: editor.name,
      meta: { docId: req.params.documentId },
    });
  }
  res.status(httpStatus.NO_CONTENT).send();
});

module.exports = {
  createDocument,
  extractPassportFields,
  getDocuments,
  getDocument,
  updateDocument,
  deleteDocument,
  getDocumentByStudentId,
};
