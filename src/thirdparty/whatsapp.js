const axios = require('axios');
const FormData = require('form-data');
const httpStatus = require('http-status');
const config = require('../config/config');
const ApiError = require('../utils/ApiError');

/**
 * WhatsApp Business Cloud API (Meta Graph) client. Modeled on fatoorah.js: a
 * module-level axios instance + thin async wrappers returning response data.
 *
 * When credentials are not configured (`isLive()` false) every call returns a
 * realistic stub so the app runs end-to-end in dev without a Meta account —
 * mirroring the stub-outside-production idiom in slack.js.
 */

const { phoneNumberId, token, wabaId, apiVersion } = config.whatsapp;

const graph = axios.create({
  baseURL: `https://graph.facebook.com/${apiVersion}`,
  timeout: 15000,
  headers: {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
  },
});

// Meta error codes worth a specific, user-facing message. Anything else falls
// through with Meta's own message. https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
const META_ERRORS = {
  131047: [
    httpStatus.CONFLICT,
    'WINDOW_CLOSED',
    'More than 24 hours since the customer last wrote — send a template instead',
  ],
  131026: [httpStatus.UNPROCESSABLE_ENTITY, 'UNDELIVERABLE', 'This number cannot receive WhatsApp messages'],
  131030: [
    httpStatus.UNPROCESSABLE_ENTITY,
    'NOT_ALLOWED_RECIPIENT',
    'Test numbers can only message the recipients added in the Meta app dashboard',
  ],
  138006: [httpStatus.CONFLICT, 'NO_PERMISSION', 'The customer has not given permission to be called'],
  138002: [httpStatus.CONFLICT, 'OUT_OF_HOURS', 'Outside the configured call hours for this number'],
  132000: [httpStatus.BAD_REQUEST, 'TEMPLATE_PARAMS', 'Template parameter count does not match the approved template'],
  132001: [httpStatus.BAD_REQUEST, 'TEMPLATE_NOT_FOUND', 'Template does not exist in this language, or is not approved'],
  133010: [
    httpStatus.SERVICE_UNAVAILABLE,
    'PHONE_NOT_REGISTERED',
    'The WhatsApp phone number is not registered with the Cloud API',
  ],
  190: [httpStatus.SERVICE_UNAVAILABLE, 'BAD_TOKEN', 'WhatsApp access token is invalid or expired'],
  130429: [httpStatus.TOO_MANY_REQUESTS, 'RATE_LIMITED', 'WhatsApp rate limit reached — try again shortly'],
};

// Turn an axios failure from Graph into an ApiError the error middleware can
// serve ({code, message}), so the inbox shows "window closed" instead of a 500.
const toApiError = (e) => {
  const meta = e && e.response && e.response.data && e.response.data.error;
  if (!meta) {
    return new ApiError(httpStatus.BAD_GATEWAY, `WhatsApp request failed: ${e && e.message ? e.message : 'unknown error'}`);
  }
  const known = META_ERRORS[meta.code];
  const details = meta.error_data && meta.error_data.details;
  const err = new ApiError(
    known ? known[0] : httpStatus.BAD_GATEWAY,
    known ? known[2] : [meta.message || 'WhatsApp request failed', details].filter(Boolean).join(': ')
  );
  err.code = known ? known[1] : `META_${meta.code}`;
  err.meta = { code: meta.code, subcode: meta.error_subcode, details: meta.error_data && meta.error_data.details };
  return err;
};

graph.interceptors.response.use(
  (res) => res,
  (e) => Promise.reject(toApiError(e))
);

const isLive = () => Boolean(token && phoneNumberId);

/** Meta wants recipient numbers as digits only (country code + number, no '+'). */
const normalizeTo = (to) => String(to || '').replace(/[^\d]/g, '');

const stubMessageId = () => `wamid.STUB${Date.now()}${Math.random().toString(36).slice(2, 8)}`;

// Meta-shaped stub templates (mapped to the frontend shape by the service).
const STUB_TEMPLATES = [
  {
    name: 'appointment_reminder',
    language: 'en',
    category: 'UTILITY',
    status: 'APPROVED',
    components: [
      { type: 'HEADER', format: 'TEXT', text: 'Appointment reminder' },
      {
        type: 'BODY',
        text: 'Hi {{1}}, a reminder about your counselling session on {{2}}. Reply here to confirm or reschedule.',
        example: { body_text: [['Ahmed', 'Monday 10:00']] },
      },
      { type: 'FOOTER', text: 'uLearn Study Abroad' },
    ],
  },
  {
    name: 'document_request',
    language: 'en',
    category: 'UTILITY',
    status: 'APPROVED',
    components: [
      {
        type: 'BODY',
        text: 'Hello {{1}}, we still need your {{2}} to move your application forward. Please share it when you can.',
        example: { body_text: [['Maria', 'passport copy']] },
      },
    ],
  },
  {
    name: 'welcome_followup',
    language: 'en',
    category: 'MARKETING',
    status: 'APPROVED',
    components: [
      {
        type: 'BODY',
        text: 'Hi {{1}}! Thanks for your interest in studying abroad with uLearn. When would be a good time for a quick call?',
        example: { body_text: [['there']] },
      },
    ],
  },
];

const sendText = async (to, body) => {
  if (!isLive()) return { messages: [{ id: stubMessageId() }] };
  const { data } = await graph.post(`/${phoneNumberId}/messages`, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: normalizeTo(to),
    type: 'text',
    text: { preview_url: true, body },
  });
  return data;
};

const sendTemplate = async (to, name, language, components) => {
  if (!isLive()) return { messages: [{ id: stubMessageId() }] };
  const { data } = await graph.post(`/${phoneNumberId}/messages`, {
    messaging_product: 'whatsapp',
    to: normalizeTo(to),
    type: 'template',
    template: {
      name,
      language: { code: language || 'en' },
      ...(components && components.length ? { components } : {}),
    },
  });
  return data;
};

/**
 * Send a media message. `media` is `{ type, link|id, caption, filename }` — we
 * prefer sending by public `link` (media stored on our bucket) over Meta media ids.
 */
const sendMedia = async (to, media) => {
  if (!isLive()) return { messages: [{ id: stubMessageId() }] };
  const { type, link, id, caption, filename } = media;
  const payload = link ? { link } : { id };
  if (caption && type !== 'audio') payload.caption = caption;
  if (filename && type === 'document') payload.filename = filename;
  const { data } = await graph.post(`/${phoneNumberId}/messages`, {
    messaging_product: 'whatsapp',
    to: normalizeTo(to),
    type,
    [type]: payload,
  });
  return data;
};

/** Resolve a Meta media id to a short-lived download URL. */
const getMediaUrl = async (mediaId) => {
  if (!isLive()) return null;
  const { data } = await graph.get(`/${mediaId}`);
  return data.url;
};

/** Download media bytes from a Meta media URL (requires the bearer token). */
const downloadMedia = async (url) => {
  if (!isLive() || !url) return Buffer.alloc(0);
  const { data } = await graph.get(url, { responseType: 'arraybuffer' });
  return Buffer.from(data);
};

/** List message templates for the WABA (used by the template picker). */
const listTemplates = async () => {
  if (!isLive() || !wabaId) return STUB_TEMPLATES;
  const { data } = await graph.get(`/${wabaId}/message_templates`, {
    params: { limit: 200 },
  });
  return data.data || [];
};

/**
 * Register the configured phone number with the Cloud API (required once before
 * it can send or receive; error 133010 means it has not been done). `pin` is the
 * 6-digit two-step-verification PIN — Meta asks for the same one on any later
 * re-registration, so keep it with the other WhatsApp secrets.
 */
const registerPhoneNumber = async (pin) => {
  if (!isLive()) return { success: true, stub: true };
  const { data } = await graph.post(`/${phoneNumberId}/register`, {
    messaging_product: 'whatsapp',
    pin: String(pin),
  });
  return data;
};

/** Live status of the configured phone number (registration, name, quality). */
const getPhoneNumberStatus = async () => {
  if (!isLive()) return null;
  const { data } = await graph.get(`/${phoneNumberId}`, {
    params: { fields: 'display_phone_number,verified_name,quality_rating,platform_type,status,code_verification_status' },
  });
  return data;
};

/**
 * Upload a file to Meta's media store and return its media id. Preferred over
 * sending a public link for voice notes: Meta validates the file at upload
 * time (clear error on bad formats) and the handset fetches it from Meta's
 * CDN rather than from our bucket.
 */
const uploadMedia = async (buffer, mimeType, filename = 'file') => {
  if (!isLive()) return { id: `media.STUB${Date.now()}` };
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', mimeType);
  form.append('file', buffer, { filename, contentType: mimeType });
  const { data } = await graph.post(`/${phoneNumberId}/media`, form, {
    headers: form.getHeaders(),
    maxBodyLength: Infinity,
  });
  return data;
};

/** Mark an inbound message as read (blue ticks on the customer side). */
const markRead = async (waMessageId) => {
  if (!isLive() || !waMessageId) return {};
  const { data } = await graph.post(`/${phoneNumberId}/messages`, {
    messaging_product: 'whatsapp',
    status: 'read',
    message_id: waMessageId,
  });
  return data;
};

// ---------------------------------------------------------------------------
// Interactive messages (call permission request) + Calling API
// ---------------------------------------------------------------------------

/**
 * Ask the customer for permission to call them. Free-form, so it only works
 * inside the 24h window (outside it, a template with a call_permission_request
 * component is required). Meta caps this at 1/day and 2/week per user in
 * production (relaxed on test numbers).
 */
const sendCallPermissionRequest = async (to, bodyText) => {
  if (!isLive()) return { messages: [{ id: stubMessageId() }] };
  const { data } = await graph.post(`/${phoneNumberId}/messages`, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: normalizeTo(to),
    type: 'interactive',
    interactive: {
      type: 'call_permission_request',
      action: { name: 'call_permission_request' },
      ...(bodyText ? { body: { text: bodyText } } : {}),
    },
  });
  return data;
};

/** Current call permission for one user: { permission: { status, expiration_time }, actions: [...] }. */
const getCallPermissions = async (userWaId) => {
  if (!isLive()) return { permission: { status: 'permanent' }, actions: [] };
  const { data } = await graph.get(`/${phoneNumberId}/call_permissions`, {
    params: { user_wa_id: normalizeTo(userWaId) },
  });
  return data;
};

/** Business-initiated call: send our SDP offer; Meta answers via the `calls` webhook (event: connect). */
const startCall = async (to, sdpOffer, bizOpaqueCallbackData) => {
  if (!isLive()) return { calls: [{ id: `wacid.STUB${Date.now()}` }] };
  const { data } = await graph.post(`/${phoneNumberId}/calls`, {
    messaging_product: 'whatsapp',
    to: normalizeTo(to),
    action: 'connect',
    session: { sdp_type: 'offer', sdp: sdpOffer },
    ...(bizOpaqueCallbackData ? { biz_opaque_callback_data: String(bizOpaqueCallbackData).slice(0, 512) } : {}),
  });
  return data;
};

/**
 * Answer a user-initiated call: Meta requires pre_accept (prepares media) and
 * then accept, both carrying our SDP answer. Ordering is enforced by the API.
 */
const acceptCall = async (callId, sdpAnswer) => {
  if (!isLive()) return { success: true };
  const base = { messaging_product: 'whatsapp', call_id: callId, session: { sdp_type: 'answer', sdp: sdpAnswer } };
  await graph.post(`/${phoneNumberId}/calls`, { ...base, action: 'pre_accept' });
  const { data } = await graph.post(`/${phoneNumberId}/calls`, { ...base, action: 'accept' });
  return data;
};

const rejectCall = async (callId) => {
  if (!isLive()) return { success: true };
  const { data } = await graph.post(`/${phoneNumberId}/calls`, {
    messaging_product: 'whatsapp',
    call_id: callId,
    action: 'reject',
  });
  return data;
};

/** Hang up. Also call this when the user ended the call (keeps Meta's billing accurate). */
const terminateCall = async (callId) => {
  if (!isLive()) return { success: true };
  const { data } = await graph.post(`/${phoneNumberId}/calls`, {
    messaging_product: 'whatsapp',
    call_id: callId,
    action: 'terminate',
  });
  return data;
};

/** Phone-number calling settings (status, icon visibility, callback permission, call hours). */
const getCallSettings = async () => {
  if (!isLive()) return { calling: { status: 'ENABLED' } };
  const { data } = await graph.get(`/${phoneNumberId}/settings`, { params: { include_sip_credentials: false } });
  return data;
};

const updateCallSettings = async (calling) => {
  if (!isLive()) return { success: true, stub: true };
  const { data } = await graph.post(`/${phoneNumberId}/settings`, { calling });
  return data;
};

module.exports = {
  isLive,
  normalizeTo,
  sendText,
  sendTemplate,
  sendMedia,
  getMediaUrl,
  downloadMedia,
  listTemplates,
  uploadMedia,
  markRead,
  registerPhoneNumber,
  getPhoneNumberStatus,
  sendCallPermissionRequest,
  getCallPermissions,
  startCall,
  acceptCall,
  rejectCall,
  terminateCall,
  getCallSettings,
  updateCallSettings,
};
