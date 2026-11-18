/* eslint-disable no-param-reassign */
const httpStatus = require('http-status');
const crypto = require('crypto');
const mongoose = require('mongoose');
const config = require('../config/config');
const logger = require('../config/logger');
const ApiError = require('../utils/ApiError');
const { Agreement, AgreementSetting, AccessRequest, User } = require('../models');
const render = require('./agreementRender.service');
const emailService = require('./email.service');
const userService = require('./user.service');

// Lazy: firebase-admin initialises on require.
// eslint-disable-next-line global-require
const storage = () => require('../thirdparty/firebase');

const CONSENT_TEXT =
  'I have read the Sub-Agent Agreement above in full. I agree to sign it electronically and I understand that my electronic signature is as binding as a handwritten one. / قرأت اتفاقية الوكيل الفرعي أعلاه كاملة وأوافق على توقيعها إلكترونيًا، وأُقر بأن توقيعي الإلكتروني ملزم كالتوقيع الخطي.';

const tokenHash = (token) =>
  crypto.createHmac('sha256', `${config.jwt.secret}:agreement-sign`).update(String(token)).digest('hex');

// The raw link token is kept encrypted (not just hashed) so a reminder can
// re-send the very same link. AES-256-GCM; key derived from the JWT secret.
const linkKey = () => crypto.createHash('sha256').update(`${config.jwt.secret}:agreement-link`).digest();
const encryptToken = (token) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', linkKey(), iv);
  const ct = Buffer.concat([cipher.update(String(token), 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ct.toString('base64url')}`;
};
const decryptToken = (enc) => {
  try {
    const [iv, tag, ct] = String(enc || '').split('.');
    const decipher = crypto.createDecipheriv('aes-256-gcm', linkKey(), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
  } catch (e) {
    return null;
  }
};

// ---------------------------------------------------------------------------
// Settings (singleton)
// ---------------------------------------------------------------------------

const getSettings = async () => {
  let s = await AgreementSetting.findOne({ key: 'default' });
  if (!s) s = await AgreementSetting.create({ key: 'default' });
  return s;
};

const updateSettings = async (patch) => {
  const s = await getSettings();
  if (patch.company) Object.assign(s.company, patch.company);
  if (patch.signatory) {
    const { signaturePath, signatureUpdatedAt, signatureUpdatedBy, ...rest } = patch.signatory;
    Object.assign(s.signatory, rest);
  }
  if (patch.defaults) Object.assign(s.defaults, patch.defaults);
  await s.save();
  return s;
};

/** data:image/png;base64,… → Buffer, with the checks a public endpoint needs. */
const pngFromDataUrl = (dataUrl, { maxBytes = 1024 * 1024 } = {}) => {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || ''));
  if (!m) throw new ApiError(httpStatus.BAD_REQUEST, 'The signature must be a PNG image');
  const buf = Buffer.from(m[1].replace(/\s+/g, ''), 'base64');
  if (buf.length < 100 || buf.length > maxBytes)
    throw new ApiError(httpStatus.BAD_REQUEST, 'The signature image is empty or too large');
  // PNG magic bytes
  if (buf.slice(0, 8).toString('hex') !== '89504e470d0a1a0a')
    throw new ApiError(httpStatus.BAD_REQUEST, 'The signature must be a PNG image');
  return buf;
};

const setSignatorySignature = async (dataUrl, by) => {
  const buf = pngFromDataUrl(dataUrl);
  const objectPath = `agreements/signatory/${crypto.randomBytes(12).toString('hex')}.png`;
  await storage().uploadPrivateBuffer(buf, objectPath, 'image/png');
  const s = await getSettings();
  s.signatory.signaturePath = objectPath;
  s.signatory.signatureUpdatedAt = new Date();
  s.signatory.signatureUpdatedBy = by && (by.id || by._id);
  await s.save();
  return s;
};

const signatorySignatureUrl = async () => {
  const s = await getSettings();
  if (!s.signatory.signaturePath) return null;
  return storage().signedReadUrl(s.signatory.signaturePath, 10);
};

const privateImageDataUrl = async (objectPath) => {
  if (!objectPath) return '';
  const buf = await storage().downloadBuffer(objectPath);
  return `data:image/png;base64,${buf.toString('base64')}`;
};

// ---------------------------------------------------------------------------
// Numbering
// ---------------------------------------------------------------------------

/** UL-SA-<year>-<0001>, one counter per year, allocated atomically. */
const nextAgreementNo = async () => {
  const year = new Date().getFullYear();
  const counters = mongoose.connection.collection('counters');
  const r = await counters.findOneAndUpdate(
    { _id: `agreement-${year}` },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' }
  );
  const seq = (r && r.value ? r.value.seq : r && r.seq) || 1;
  return `UL-SA-${year}-${String(seq).padStart(4, '0')}`;
};

// ---------------------------------------------------------------------------
// Drafting
// ---------------------------------------------------------------------------

/** The Second Party, as the access request describes them. */
const agentFromRequest = (request) => {
  const p = request.personInCharge || {};
  const signer = p.name
    ? p
    : {
        name: request.name,
        nameAr: request.nameAr,
        email: request.email,
        phoneCode: request.phoneCode,
        phone: request.phone,
        civilIdNumber: '',
      };
  const mobile = [signer.phoneCode || request.phoneCode, signer.phone || request.phone].filter(Boolean).join(' ');
  return {
    nameEn: signer.name || request.name,
    nameAr: signer.nameAr || request.nameAr || '',
    civilId: p.civilIdNumber || '',
    mobile,
    email: String(signer.email || request.email).toLowerCase(),
    accountEmail: String(request.email).toLowerCase(),
    organisationEn: request.organisation,
    organisationAr: request.organisationAr || '',
  };
};

const normaliseCommission = (c) => {
  if (!c || !['percentage', 'fixed'].includes(c.type))
    throw new ApiError(httpStatus.BAD_REQUEST, 'Choose a percentage or a fixed amount per student');
  const value = Number(c.value);
  if (!Number.isFinite(value) || value <= 0)
    throw new ApiError(httpStatus.BAD_REQUEST, 'The commission must be a positive number');
  if (c.type === 'percentage' && value > 100) throw new ApiError(httpStatus.BAD_REQUEST, 'A percentage cannot exceed 100');
  const out = { type: c.type, value, currency: c.type === 'fixed' ? String(c.currency || 'GBP').toUpperCase() : undefined };
  const text = render.commissionText(out);
  out.textEn = text.en;
  out.textAr = text.ar;
  return out;
};

const normaliseTerms = (terms) =>
  (Array.isArray(terms) ? terms : [])
    .map((t) => ({ en: String((t && t.en) || '').trim(), ar: String((t && t.ar) || '').trim() }))
    .filter((t) => t.en)
    .slice(0, 20);

/**
 * A draft from an access request. Nothing is sent yet.
 */
const createDraft = async ({ request, commission, extraTerms, autoCountersign, by }) => {
  if (!request) throw new ApiError(httpStatus.NOT_FOUND, 'Access request not found');
  if (request.requestedRole !== 'subAgent') throw new ApiError(httpStatus.BAD_REQUEST, 'Agreements are for sub-agents');
  const settings = await getSettings();
  const agreement = await Agreement.create({
    agreementNo: await nextAgreementNo(),
    templateVersion: render.TEMPLATE_VERSION,
    accessRequest: request._id,
    user: request.user || undefined,
    agent: agentFromRequest(request),
    commission: normaliseCommission(commission),
    extraTerms: normaliseTerms(extraTerms),
    autoCountersign: autoCountersign === undefined ? settings.defaults.autoCountersign : Boolean(autoCountersign),
    createdBy: by && (by.id || by._id),
    createdByName: by && by.name,
    events: [{ type: 'created', by: by && (by.id || by._id), byName: by && by.name }],
  });
  return agreement;
};

/** HTML of what the partner would see, for the reviewer's preview. */
const previewHtml = async ({ request, commission, extraTerms }) => {
  const settings = await getSettings();
  const draft = {
    agreementNo: 'DRAFT',
    templateVersion: render.TEMPLATE_VERSION,
    agent: agentFromRequest(request),
    commission: normaliseCommission(commission),
    extraTerms: normaliseTerms(extraTerms),
    agreementDate: new Date(),
  };
  return render.renderHtml(draft, settings);
};

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

const signUrlFor = (token) => `${config.appUrls.subAgentPortal}/sign/${token}`;

const issueToken = async (agreement, settings) => {
  const token = crypto.randomBytes(32).toString('base64url');
  const days = (settings.defaults && settings.defaults.linkExpiryDays) || 14;
  agreement.signToken = {
    hash: tokenHash(token),
    enc: encryptToken(token),
    expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
  };
  agreement.expiresAt = agreement.signToken.expiresAt;
  return token;
};

const pushEvent = (agreement, type, meta = {}) => {
  agreement.events.push({
    type,
    at: new Date(),
    ip: meta.ip,
    userAgent: meta.userAgent,
    by: meta.by,
    byName: meta.byName,
    note: meta.note,
  });
};

/**
 * Email the partner and write what the provider said into the audit trail.
 *
 * A failure is RECORDED, not thrown. By the time this runs the agreement is
 * already Sent and its signing link is valid, so the right recovery is
 * "Re-send signing link", not undoing the approval — and throwing here used to
 * leave a Sent agreement behind an access request that had bounced back to
 * Pending, which then blocked the next approval with "already has agreement".
 * Returns true when the provider accepted the message.
 */
const emailPartner = async (agreement, sendFn, { by } = {}) => {
  const to = agreement.agent.email;
  try {
    const mail = await sendFn();
    const providerId = mail && mail.id ? String(mail.id) : undefined;
    agreement.lastEmail = { to, at: new Date(), providerId, error: undefined };
    pushEvent(agreement, 'emailed', {
      by: by && (by.id || by._id),
      byName: by && by.name,
      note: `to ${to}${providerId ? ` · Resend id ${providerId}` : ''}`,
    });
  } catch (err) {
    const message = String((err && err.message) || err).slice(0, 300);
    logger.error(`agreement ${agreement.agreementNo}: email to ${to} failed: ${message}`);
    agreement.lastEmail = { to, at: new Date(), providerId: undefined, error: message };
    pushEvent(agreement, 'email_failed', { note: `to ${to} · ${message}` });
  }
  await agreement.save();
  return !agreement.lastEmail.error;
};

const assertStorageReady = async () => {
  try {
    await getSettings();
  } catch (e) {
    throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Agreement settings are not available');
  }
};

/**
 * Send for signature: fix the date, render the unsigned PDF (its hash is what
 * the certificate later refers to), issue the link and email it with the PDF.
 */
const send = async (agreement, { by, ip, userAgent } = {}) => {
  if (!['Draft'].includes(agreement.status))
    throw new ApiError(httpStatus.CONFLICT, `This agreement is already ${agreement.status.toLowerCase()}`);
  await assertStorageReady();
  const settings = await getSettings();
  if (!settings.signatory.signaturePath && agreement.autoCountersign) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "Add the company signatory's signature in Settings → Agreements first, or turn off automatic countersigning for this agreement."
    );
  }
  agreement.agreementDate = new Date();
  const { buffer, sha256: hash } = await render.renderPdf(agreement, settings);
  agreement.documentHash = hash;
  const token = await issueToken(agreement, settings);
  agreement.status = 'Sent';
  agreement.sentAt = new Date();
  pushEvent(agreement, 'sent', { ip, userAgent, by: by && (by.id || by._id), byName: by && by.name });
  await agreement.save();

  await emailPartner(
    agreement,
    () =>
      emailService.sendAgreementSentEmail(agreement, {
        signUrl: signUrlFor(token),
        expiresAt: agreement.expiresAt,
        pdf: buffer,
      }),
    { by }
  );
  return agreement;
};

const resend = async (agreement, { by, ip, userAgent } = {}) => {
  if (!['Sent', 'Viewed', 'Expired'].includes(agreement.status)) {
    throw new ApiError(httpStatus.CONFLICT, 'Only an agreement that is waiting for the partner can be re-sent');
  }
  const settings = await getSettings();
  const { buffer } = await render.renderPdf(agreement, settings);
  const token = await issueToken(agreement, settings);
  if (agreement.status === 'Expired') agreement.status = 'Sent';
  pushEvent(agreement, 'resent', { ip, userAgent, by: by && (by.id || by._id), byName: by && by.name });
  await agreement.save();
  const accepted = await emailPartner(
    agreement,
    () =>
      emailService.sendAgreementSentEmail(agreement, {
        signUrl: signUrlFor(token),
        expiresAt: agreement.expiresAt,
        pdf: buffer,
        resend: true,
      }),
    { by }
  );
  // A re-send is someone watching the button: tell them, with the provider's words.
  if (!accepted) {
    throw new ApiError(httpStatus.BAD_GATEWAY, `The email to ${agreement.agent.email} failed: ${agreement.lastEmail.error}`);
  }
  return agreement;
};

// ---------------------------------------------------------------------------
// Signing (public, by token)
// ---------------------------------------------------------------------------

const findBySignToken = async (token) => {
  if (!token || String(token).length < 20) return null;
  return Agreement.findOne({ 'signToken.hash': tokenHash(token) });
};

const assertSignable = (agreement) => {
  if (!agreement) throw new ApiError(httpStatus.NOT_FOUND, 'This signing link is not valid');
  if (['Completed', 'AgentSigned'].includes(agreement.status))
    throw new ApiError(httpStatus.CONFLICT, 'This agreement has already been signed');
  if (['Voided', 'Declined'].includes(agreement.status))
    throw new ApiError(httpStatus.GONE, 'This agreement is no longer open for signature');
  if (agreement.status === 'Expired' || (agreement.signToken.expiresAt && agreement.signToken.expiresAt < new Date())) {
    throw new ApiError(httpStatus.GONE, 'This signing link has expired — ask Ulearn to send a new one');
  }
};

/** What the public signing page shows. */
const publicView = (agreement, html) => ({
  agreementNo: agreement.agreementNo,
  status: agreement.status,
  agreementDate: agreement.agreementDate,
  expiresAt: agreement.expiresAt,
  agent: {
    nameEn: agreement.agent.nameEn,
    nameAr: agreement.agent.nameAr,
    email: agreement.agent.email,
    organisationEn: agreement.agent.organisationEn,
    organisationAr: agreement.agent.organisationAr,
  },
  // No commission here: the partner reads it in the contract itself (html), nowhere else.
  consentText: CONSENT_TEXT,
  html,
});

const openForSigning = async (token, { ip, userAgent } = {}) => {
  const agreement = await findBySignToken(token);
  assertSignable(agreement);
  const settings = await getSettings();
  if (agreement.status === 'Sent') {
    agreement.status = 'Viewed';
    agreement.viewedAt = new Date();
    pushEvent(agreement, 'viewed', { ip, userAgent });
    await agreement.save();
  }
  const html = render.renderHtml(agreement, settings);
  return publicView(agreement, html);
};

/**
 * The partner signs. Stores the signature privately, records the audit
 * facts, then either countersigns automatically (default) or waits for a
 * reviewer. `io` lets the reviewer notification go out over the socket.
 */
const signByAgent = async (token, { signatureDataUrl, method, typedName, consent, ip, userAgent }, { io } = {}) => {
  const agreement = await findBySignToken(token);
  assertSignable(agreement);
  if (consent !== true) throw new ApiError(httpStatus.BAD_REQUEST, 'Please confirm that you agree to sign electronically');
  const buf = pngFromDataUrl(signatureDataUrl);
  const objectPath = `agreements/${agreement.agreementNo}/agent-signature-${crypto.randomBytes(8).toString('hex')}.png`;
  await storage().uploadPrivateBuffer(buf, objectPath, 'image/png');

  agreement.signatures = agreement.signatures || {};
  agreement.signatures.agent = {
    imagePath: objectPath,
    method: ['typed', 'uploaded'].includes(method) ? method : 'drawn',
    typedName:
      method === 'typed'
        ? String(typedName || '')
            .trim()
            .slice(0, 120)
        : undefined,
    signedAt: new Date(),
    ip,
    userAgent,
    email: agreement.agent.email,
    consentText: CONSENT_TEXT,
  };
  agreement.status = 'AgentSigned';
  agreement.agentSignedAt = new Date();
  // The link has done its job; nothing further can be signed with it.
  agreement.signToken = undefined;
  pushEvent(agreement, 'agent_signed', { ip, userAgent, byName: agreement.agent.nameEn });
  await agreement.save();

  const settings = await getSettings();
  if (agreement.autoCountersign && settings.signatory.signaturePath) {
    // eslint-disable-next-line no-use-before-define
    await countersign(agreement, { auto: true, ip: 'server', userAgent: 'auto-countersign' });
  } else {
    // eslint-disable-next-line no-use-before-define
    await notifyReviewers(
      io,
      `${agreement.agent.nameEn} (${agreement.agent.organisationEn || 'sub-agent'}) signed agreement ${
        agreement.agreementNo
      } — it needs Ulearn's countersignature.`
    );
  }
  return agreement;
};

const decline = async (token, reason, { ip, userAgent } = {}, { io } = {}) => {
  const agreement = await findBySignToken(token);
  assertSignable(agreement);
  agreement.status = 'Declined';
  agreement.declineReason = String(reason || '')
    .trim()
    .slice(0, 1000);
  agreement.signToken = undefined;
  pushEvent(agreement, 'agent_declined', { ip, userAgent, byName: agreement.agent.nameEn, note: agreement.declineReason });
  await agreement.save();
  // eslint-disable-next-line no-use-before-define
  await notifyReviewers(
    io,
    `${agreement.agent.nameEn} declined agreement ${agreement.agreementNo}${
      agreement.declineReason ? `: ${agreement.declineReason}` : ''
    }.`
  );
  return agreement;
};

// ---------------------------------------------------------------------------
// Countersign + complete
// ---------------------------------------------------------------------------

/**
 * Ulearn signs. Either automatically right after the partner (the sender
 * chose that when sending — their click is the authorisation, and the
 * signatory's signature on file is what gets applied) or by a reviewer later.
 */
const countersign = async (agreement, { by, auto, ip, userAgent } = {}) => {
  if (agreement.status !== 'AgentSigned') throw new ApiError(httpStatus.CONFLICT, 'The partner has not signed yet');
  const settings = await getSettings();
  if (!settings.signatory.signaturePath) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'No company signature is on file — add it in Settings → Agreements');
  }
  const sender = by || (agreement.createdBy ? await User.findById(agreement.createdBy).select('name') : null);
  agreement.signatures.company = {
    imagePath: settings.signatory.signaturePath,
    method: 'stored',
    signedAt: new Date(),
    ip: ip || '',
    userAgent: userAgent || '',
    by: sender && (sender.id || sender._id),
    byName: auto
      ? `${settings.signatory.nameEn} (applied automatically, authorised by ${(sender && sender.name) || 'the sender'})`
      : (sender && sender.name) || settings.signatory.nameEn,
  };
  agreement.countersignedAt = new Date();
  pushEvent(agreement, 'countersigned', {
    ip,
    userAgent,
    by: sender && (sender.id || sender._id),
    byName: agreement.signatures.company.byName,
  });
  await agreement.save();
  // eslint-disable-next-line no-use-before-define
  return complete(agreement, settings);
};

/**
 * Both signed: render the final PDF (the contract with both signatures), store
 * it, open the partner's portal (account + set-password invite) and email
 * everyone their copy.
 */
const complete = async (agreement, settings) => {
  const s = settings || (await getSettings());
  const [agentSig, companySig] = await Promise.all([
    privateImageDataUrl(agreement.signatures.agent && agreement.signatures.agent.imagePath),
    privateImageDataUrl(agreement.signatures.company && agreement.signatures.company.imagePath),
  ]);
  agreement.status = 'Completed';
  agreement.completedAt = new Date();
  pushEvent(agreement, 'completed');

  const {
    buffer,
    pages,
    sha256: hash,
  } = await render.renderPdf(agreement, s, {
    agentSignatureSrc: agentSig,
    companySignatureSrc: companySig,
    // The signed contract only. The certificate-of-completion page is not
    // appended: how and when each party signed stays on the agreement's own
    // record (events, IPs, document hash) in the back office.
  });
  const objectPath = `agreements/${agreement.agreementNo}/${agreement.agreementNo}-signed.pdf`;
  await storage().uploadPrivateBuffer(buffer, objectPath, 'application/pdf');
  agreement.pdf = { path: objectPath, sha256: hash, pages, bytes: buffer.length, generatedAt: new Date() };
  await agreement.save();

  // ---- the partner's account -------------------------------------------
  let inviteSent = false;
  let user = agreement.user ? await User.findById(agreement.user) : null;
  const request = agreement.accessRequest ? await AccessRequest.findById(agreement.accessRequest) : null;
  if (!user && request) {
    const existing = await userService.getUserByEmail(request.email);
    if (existing) {
      user = existing;
    } else {
      // eslint-disable-next-line global-require
      const accessRequestService = require('./accessRequest.service');
      try {
        user = await accessRequestService.provisionUserForRequest(request);
        request.user = user.id;
        await accessRequestService.sendInvite(request, user);
        inviteSent = true;
        pushEvent(agreement, 'invite_sent', { byName: 'system' });
      } catch (err) {
        logger.error(`agreement ${agreement.agreementNo}: provisioning failed: ${err.message}`);
      }
    }
  }
  if (user) {
    agreement.user = user._id;
    await User.updateOne({ _id: user._id }, { $set: { agreement: agreement._id } });
    if (request && !request.user) request.user = user._id;
  }
  if (request) {
    request.agreement = agreement._id;
    await request.save();
  }
  await agreement.save();

  // ---- copies to both sides ---------------------------------------------
  try {
    await emailService.sendAgreementCompletedEmail(agreement, { pdf: buffer, inviteSent, settings: s });
  } catch (err) {
    logger.error(`agreement ${agreement.agreementNo}: completion email failed: ${err.message}`);
  }
  return agreement;
};

// ---------------------------------------------------------------------------
// Admin actions
// ---------------------------------------------------------------------------

const voidAgreement = async (agreement, reason, { by, ip, userAgent } = {}) => {
  if (agreement.status === 'Completed')
    throw new ApiError(httpStatus.CONFLICT, 'A completed agreement cannot be voided here');
  agreement.status = 'Voided';
  agreement.voidedAt = new Date();
  agreement.voidReason = String(reason || '')
    .trim()
    .slice(0, 1000);
  agreement.signToken = undefined;
  pushEvent(agreement, 'voided', {
    ip,
    userAgent,
    by: by && (by.id || by._id),
    byName: by && by.name,
    note: agreement.voidReason,
  });
  await agreement.save();
  return agreement;
};

const listAgreements = async ({ status, limit = 200 } = {}) => {
  const filter = {};
  if (status && status !== 'All') {
    filter.status = status === 'Open' ? { $in: ['Draft', 'Sent', 'Viewed', 'AgentSigned', 'Expired'] } : status;
  }
  return Agreement.find(filter).sort({ createdAt: -1 }).limit(limit);
};

const getById = async (id) => Agreement.findById(id);
const getByAccessRequest = async (requestId) => Agreement.findOne({ accessRequest: requestId }).sort({ createdAt: -1 });
const getByUser = async (userId) => Agreement.findOne({ user: userId, status: 'Completed' }).sort({ completedAt: -1 });

const pdfLink = async (agreement, minutes = 10) => {
  if (!agreement.pdf || !agreement.pdf.path) throw new ApiError(httpStatus.NOT_FOUND, 'The signed PDF is not ready yet');
  return {
    url: await storage().signedReadUrl(agreement.pdf.path, minutes),
    expiresAt: new Date(Date.now() + minutes * 60 * 1000),
    fileName: `${agreement.agreementNo}.pdf`,
  };
};

/** A fresh unsigned/partially signed PDF for a reviewer to look at. */
const currentPdf = async (agreement) => {
  const settings = await getSettings();
  const agentSig = await privateImageDataUrl(
    agreement.signatures && agreement.signatures.agent && agreement.signatures.agent.imagePath
  );
  return render.renderPdf(agreement, settings, { agentSignatureSrc: agentSig });
};

const notifyReviewers = async (io, message) => {
  try {
    // eslint-disable-next-line global-require
    const { reviewerRoleIds } = require('./roleAccess.service');
    // eslint-disable-next-line global-require
    const notificationsService = require('./notifications.services');
    const reviewers = await User.find({ role: { $in: reviewerRoleIds() } }).select('_id');
    const ids = reviewers.map((u) => u._id.toString());
    if (ids.length)
      await notificationsService.createNotification(io, ids, message, 'system', undefined, undefined, undefined);
  } catch (err) {
    logger.error(`agreement reviewer notification failed: ${err.message}`);
  }
};

/**
 * Reminders for unsigned agreements, and expiry. Called on a timer from
 * index.js (hourly); idempotent, so running it twice sends nothing twice.
 */
// eslint-disable-next-line no-restricted-syntax
const sendReminders = async () => {
  const settings = await getSettings();
  const days = (settings.defaults.reminderDays || [])
    .map(Number)
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  const open = await Agreement.find({ status: { $in: ['Sent', 'Viewed'] } });
  const now = Date.now();
  let reminded = 0;
  let expired = 0;
  // eslint-disable-next-line no-restricted-syntax
  for (const a of open) {
    if (a.signToken && a.signToken.expiresAt && a.signToken.expiresAt.getTime() < now) {
      a.status = 'Expired';
      pushEvent(a, 'expired', { byName: 'system' });
      // eslint-disable-next-line no-await-in-loop
      await a.save();
      expired += 1;
      // eslint-disable-next-line no-continue
      continue;
    }
    const ageDays = (now - new Date(a.sentAt).getTime()) / 86400000;
    const due = days.filter((d) => ageDays >= d).length;
    if (due > a.remindersSent) {
      try {
        // Claim the reminder atomically first: with two API instances running
        // this hourly, only the one that wins the update sends the email.
        // eslint-disable-next-line no-await-in-loop
        const claimed = await Agreement.findOneAndUpdate(
          { _id: a._id, remindersSent: a.remindersSent, status: { $in: ['Sent', 'Viewed'] } },
          {
            $set: { remindersSent: due, lastReminderAt: new Date() },
            $push: { events: { type: 'reminder_sent', at: new Date(), byName: 'system' } },
          },
          { new: true }
        );
        // eslint-disable-next-line no-continue
        if (!claimed) continue;
        const raw = a.signToken && a.signToken.enc ? decryptToken(a.signToken.enc) : null;
        if (!raw) throw new Error('signing link cannot be recovered');
        // eslint-disable-next-line no-await-in-loop
        await emailService.sendAgreementReminderEmail(a, { signUrl: signUrlFor(raw), expiresAt: a.signToken.expiresAt });
        reminded += 1;
      } catch (err) {
        logger.error(`agreement ${a.agreementNo}: reminder failed: ${err.message}`);
      }
    }
  }
  return { reminded, expired };
};

module.exports = {
  CONSENT_TEXT,
  getSettings,
  updateSettings,
  setSignatorySignature,
  signatorySignatureUrl,
  nextAgreementNo,
  agentFromRequest,
  normaliseCommission,
  normaliseTerms,
  createDraft,
  previewHtml,
  send,
  resend,
  findBySignToken,
  openForSigning,
  signByAgent,
  decline,
  countersign,
  complete,
  voidAgreement,
  listAgreements,
  getById,
  getByAccessRequest,
  getByUser,
  pdfLink,
  currentPdf,
  sendReminders,
};
