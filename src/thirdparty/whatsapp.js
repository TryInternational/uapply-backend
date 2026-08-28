const axios = require('axios');
const config = require('../config/config');

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
  headers: {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
  },
});

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

module.exports = {
  isLive,
  normalizeTo,
  sendText,
  sendTemplate,
  sendMedia,
  getMediaUrl,
  downloadMedia,
  listTemplates,
  markRead,
};
