const httpStatus = require('http-status');
const ApiError = require('../utils/ApiError');
const catchAsync = require('../utils/catchAsync');
const logger = require('../config/logger');
const { agreementService, accessRequestService } = require('../services');
const { isAdmin } = require('../middlewares/subAgentScope');

const clientMeta = (req) => ({
  ip: req.ip,
  userAgent: String(req.get('user-agent') || '').slice(0, 300),
});

const actor = (req) => ({ id: req.user.id, _id: req.user._id, name: req.user.name });

// ---------------------------------------------------------------------------
// Reviewers
// ---------------------------------------------------------------------------

const list = catchAsync(async (req, res) => {
  const rows = await agreementService.listAgreements({ status: req.query.status, limit: Number(req.query.limit) || 200 });
  res.send(rows);
});

const get = catchAsync(async (req, res) => {
  const a = await agreementService.getById(req.params.agreementId);
  if (!a) throw new ApiError(httpStatus.NOT_FOUND, 'Agreement not found');
  res.send(a);
});

/** Draft (and by default send) an agreement for an access request. */
const create = catchAsync(async (req, res) => {
  const request = await accessRequestService.getAccessRequestById(req.body.accessRequestId);
  if (!request) throw new ApiError(httpStatus.NOT_FOUND, 'Access request not found');
  const existing = await agreementService.getByAccessRequest(request._id);
  if (existing && !['Voided', 'Declined', 'Expired'].includes(existing.status)) {
    throw new ApiError(
      httpStatus.CONFLICT,
      `This partner already has agreement ${existing.agreementNo} (${existing.status})`
    );
  }
  let agreement = await agreementService.createDraft({
    request,
    commission: req.body.commission,
    extraTerms: req.body.extraTerms,
    autoCountersign: req.body.autoCountersign,
    by: actor(req),
  });
  if (req.body.send !== false) {
    agreement = await agreementService.send(agreement, { by: actor(req), ...clientMeta(req) });
  }
  res.status(httpStatus.CREATED).send(agreement);
});

const preview = catchAsync(async (req, res) => {
  const request = await accessRequestService.getAccessRequestById(req.body.accessRequestId);
  if (!request) throw new ApiError(httpStatus.NOT_FOUND, 'Access request not found');
  const html = await agreementService.previewHtml({
    request,
    commission: req.body.commission,
    extraTerms: req.body.extraTerms,
  });
  res.type('html').send(html);
});

const send = catchAsync(async (req, res) => {
  const a = await agreementService.getById(req.params.agreementId);
  if (!a) throw new ApiError(httpStatus.NOT_FOUND, 'Agreement not found');
  res.send(await agreementService.send(a, { by: actor(req), ...clientMeta(req) }));
});

const resend = catchAsync(async (req, res) => {
  const a = await agreementService.getById(req.params.agreementId);
  if (!a) throw new ApiError(httpStatus.NOT_FOUND, 'Agreement not found');
  res.send(await agreementService.resend(a, { by: actor(req), ...clientMeta(req) }));
});

/** Manual countersign. Admins, or the configured signatory account. */
const countersign = catchAsync(async (req, res) => {
  const a = await agreementService.getById(req.params.agreementId);
  if (!a) throw new ApiError(httpStatus.NOT_FOUND, 'Agreement not found');
  const settings = await agreementService.getSettings();
  const signatoryUser = settings.signatory.user ? String(settings.signatory.user) : null;
  if (!isAdmin(req.user) && !(signatoryUser && signatoryUser === String(req.user.id))) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Only an admin or the company signatory can countersign');
  }
  const done = await agreementService.countersign(a, { by: actor(req), ...clientMeta(req) });
  logger.info(`agreement ${a.agreementNo} countersigned by ${req.user.email || req.user.id}`);
  res.send(done);
});

const voidAgreement = catchAsync(async (req, res) => {
  const a = await agreementService.getById(req.params.agreementId);
  if (!a) throw new ApiError(httpStatus.NOT_FOUND, 'Agreement not found');
  res.send(await agreementService.voidAgreement(a, req.body.reason, { by: actor(req), ...clientMeta(req) }));
});

/** Signed PDF link (completed) — ten minutes, logged. */
const pdfLink = catchAsync(async (req, res) => {
  const a = await agreementService.getById(req.params.agreementId);
  if (!a) throw new ApiError(httpStatus.NOT_FOUND, 'Agreement not found');
  const link = await agreementService.pdfLink(a);
  logger.info(`agreement ${a.agreementNo} pdf opened by ${req.user.email || req.user.id}`);
  res.send(link);
});

/** The document as it stands right now (unsigned or partly signed), streamed. */
const currentPdf = catchAsync(async (req, res) => {
  const a = await agreementService.getById(req.params.agreementId);
  if (!a) throw new ApiError(httpStatus.NOT_FOUND, 'Agreement not found');
  const { buffer } = await agreementService.currentPdf(a);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `inline; filename="${a.agreementNo}${a.status === 'Completed' ? '' : '-preview'}.pdf"`
  );
  res.send(buffer);
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const getSettings = catchAsync(async (req, res) => {
  res.send(await agreementService.getSettings());
});

const updateSettings = catchAsync(async (req, res) => {
  res.send(await agreementService.updateSettings(req.body));
});

const setSignature = catchAsync(async (req, res) => {
  res.send(await agreementService.setSignatorySignature(req.body.signature, actor(req)));
});

const signatureLink = catchAsync(async (req, res) => {
  const url = await agreementService.signatorySignatureUrl();
  if (!url) throw new ApiError(httpStatus.NOT_FOUND, 'No signature on file');
  res.send({ url });
});

// ---------------------------------------------------------------------------
// The partner's own view (sub-agent portal)
// ---------------------------------------------------------------------------

const mine = catchAsync(async (req, res) => {
  const a = await agreementService.getByUser(req.user.id);
  if (!a) return res.send(null);
  const json = a.toJSON();
  return res.send({
    id: json.id,
    agreementNo: json.agreementNo,
    status: json.status,
    agreementDate: json.agreementDate,
    completedAt: json.completedAt,
    // The commission stays in the signed PDF; the portal never shows it.
    extraTerms: json.extraTerms,
    pdf: json.pdf,
  });
});

const minePdfLink = catchAsync(async (req, res) => {
  const a = await agreementService.getByUser(req.user.id);
  if (!a) throw new ApiError(httpStatus.NOT_FOUND, 'No agreement on file');
  res.send(await agreementService.pdfLink(a));
});

// ---------------------------------------------------------------------------
// Public signing (by emailed token)
// ---------------------------------------------------------------------------

const openForSigning = catchAsync(async (req, res) => {
  res.send(await agreementService.openForSigning(req.params.token, clientMeta(req)));
});

const sign = catchAsync(async (req, res) => {
  const a = await agreementService.signByAgent(
    req.params.token,
    {
      signatureDataUrl: req.body.signature,
      method: req.body.method,
      typedName: req.body.typedName,
      consent: req.body.consent,
      ...clientMeta(req),
    },
    { io: req.app.get('io') }
  );
  res.send({
    agreementNo: a.agreementNo,
    status: a.status,
    completed: a.status === 'Completed',
    email: a.agent.email,
    accountEmail: a.agent.accountEmail,
  });
});

const declineSigning = catchAsync(async (req, res) => {
  const a = await agreementService.decline(req.params.token, req.body.reason, clientMeta(req), { io: req.app.get('io') });
  res.send({ agreementNo: a.agreementNo, status: a.status });
});

module.exports = {
  list,
  get,
  create,
  preview,
  send,
  resend,
  countersign,
  voidAgreement,
  pdfLink,
  currentPdf,
  getSettings,
  updateSettings,
  setSignature,
  signatureLink,
  mine,
  minePdfLink,
  openForSigning,
  sign,
  declineSigning,
};
