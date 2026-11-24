/**
 * Webhook processing rules that must hold whatever Meta does on the wire:
 *  - a retried inbound webhook (same wamid) is stored once;
 *  - delivery receipts only move forward (sent → delivered → read), failed wins.
 * Models are faked in memory, so this runs without a database.
 */
const mongoose = require('mongoose');

const store = { conversations: [], messages: [] };
const doc = (data) => {
  const d = { _id: new mongoose.Types.ObjectId(), ...data };
  d.save = async () => d;
  d.populate = async () => d;
  return d;
};
const matches = (q) => (d) =>
  Object.entries(q).every(([k, v]) => {
    const val = k.split('.').reduce((o, p) => (o == null ? o : o[p]), d);
    return v instanceof RegExp ? v.test(val) : String(val) === String(v);
  });

jest.mock('../../../src/models', () => ({
  Students: { findOne: () => ({ select: async () => null }) },
  WhatsappConversation: {
    findOne: async (q) => store.conversations.find(matches(q)) || null,
    findById: (id) => ({ populate: async () => store.conversations.find((c) => String(c._id) === String(id)) || null }),
    create: async (data) => {
      const d = doc({ unreadCount: 0, assignees: [], ...data });
      store.conversations.push(d);
      return d;
    },
  },
  WhatsappMessage: {
    exists: async (q) => (store.messages.some(matches(q)) ? { _id: 1 } : null),
    findOne: async (q) => store.messages.find(matches(q)) || null,
    findById: async (id) => store.messages.find((m) => String(m._id) === String(id)) || null,
    create: async (data) => {
      const d = doc(data);
      store.messages.push(d);
      return d;
    },
  },
}));
jest.mock('../../../src/thirdparty', () => ({
  whatsapp: { getMediaUrl: async () => null, downloadMedia: async () => null },
}));
jest.mock('../../../src/thirdparty/firebase', () => ({}));
jest.mock('../../../src/services/notifications.services', () => ({ createWhatsappNotification: async () => {} }));
jest.mock('../../../src/services/roleAccess.service', () => ({ isAdmin: () => false }));
jest.mock('../../../src/config/config', () => ({ whatsapp: {}, env: 'test' }));

const whatsappService = require('../../../src/services/whatsapp.services');

const io = { to: () => ({ emit: () => {} }) };

const inbound = (id, body = 'hello') => ({
  entry: [
    {
      changes: [
        {
          value: {
            contacts: [{ profile: { name: 'Test User' }, wa_id: '96550000001' }],
            messages: [{ from: '96550000001', id, timestamp: '1710000000', type: 'text', text: { body } }],
          },
        },
      ],
    },
  ],
});

const statusEvent = (id, status, errors) => ({
  entry: [{ changes: [{ value: { statuses: [{ id, status, ...(errors && { errors }) }] } }] }],
});

beforeEach(() => {
  store.conversations = [];
  store.messages = [];
});

describe('whatsapp webhook processing', () => {
  test('a retried inbound webhook (same wamid) stores the message once', async () => {
    await whatsappService.processWebhook(io, inbound('wamid.A'));
    await whatsappService.processWebhook(io, inbound('wamid.A'));
    await whatsappService.processWebhook(io, inbound('wamid.B', 'second'));
    expect(store.messages.filter((m) => m.waMessageId === 'wamid.A')).toHaveLength(1);
    expect(store.messages).toHaveLength(2);
    expect(store.conversations).toHaveLength(1);
    expect(store.conversations[0].unreadCount).toBe(2);
  });

  test('an event for a number that is not ours (the sample the Meta "Test" button sends) is not stored', async () => {
    // eslint-disable-next-line global-require
    const config = require('../../../src/config/config');
    config.whatsapp.phoneNumberId = '700000000000001';
    const forNumber = (phoneNumberId, id) => {
      const body = inbound(id);
      body.entry[0].changes[0].value.metadata = { display_phone_number: '16505551111', phone_number_id: phoneNumberId };
      return body;
    };
    try {
      await whatsappService.processWebhook(io, forNumber('123456123', 'wamid.SAMPLE'));
      expect(store.messages).toHaveLength(0);
      expect(store.conversations).toHaveLength(0);

      await whatsappService.processWebhook(io, forNumber('700000000000001', 'wamid.REAL'));
      expect(store.messages).toHaveLength(1);
      // an event that names no number is let through, as before
      await whatsappService.processWebhook(io, inbound('wamid.NO_META'));
      expect(store.messages).toHaveLength(2);
    } finally {
      delete config.whatsapp.phoneNumberId;
    }
  });

  test('an internal note does not answer the student: the chat still needs a reply', async () => {
    await whatsappService.processWebhook(io, inbound('wamid.Q', 'is anyone there?'));
    const [conv] = store.conversations;
    expect(conv.lastMessage.direction).toBe('inbound');
    await whatsappService.addNote(io, conv._id, 'call them back', [], { _id: new mongoose.Types.ObjectId(), name: 'Staff' });
    expect(conv.lastMessage.preview).toBe('📝 Internal note');
    // the dashboard's waiting count and the inbox's "Needs reply" chip read this
    expect(conv.lastMessage.direction).toBe('inbound');
    expect(store.messages.filter((m) => m.internal)).toHaveLength(1);
  });

  test('resolving a chat stamps the moment; reopening clears it', async () => {
    await whatsappService.processWebhook(io, inbound('wamid.R'));
    const [conv] = store.conversations;
    await whatsappService.updateConversationMeta(conv._id, { status: 'resolved' });
    expect(conv.status).toBe('resolved');
    expect(conv.resolvedAt).toBeInstanceOf(Date);
    const first = conv.resolvedAt;
    // saving other details of a resolved chat does not move the date
    await whatsappService.updateConversationMeta(conv._id, { status: 'resolved', priority: 'low' });
    expect(conv.resolvedAt).toBe(first);
    await whatsappService.updateConversationMeta(conv._id, { status: 'open' });
    expect(conv.resolvedAt).toBeUndefined();
  });

  test('status receipts only move forward, and failed always wins', async () => {
    const conv = doc({ contact: { phone: '96550000002', waId: '96550000002' }, assignees: [] });
    store.conversations.push(conv);
    const msg = doc({
      conversation: conv._id,
      waMessageId: 'wamid.OUT',
      direction: 'outbound',
      type: 'text',
      status: 'sent',
    });
    store.messages.push(msg);

    await whatsappService.processWebhook(io, statusEvent('wamid.OUT', 'read'));
    await whatsappService.processWebhook(io, statusEvent('wamid.OUT', 'delivered')); // late receipt
    expect(msg.status).toBe('read');

    await whatsappService.processWebhook(
      io,
      statusEvent('wamid.OUT', 'failed', [{ code: 131047, title: 'Re-engagement message' }])
    );
    expect(msg.status).toBe('failed');
    expect(msg.error).toEqual({ code: '131047', title: 'Re-engagement message' });

    await whatsappService.processWebhook(io, statusEvent('wamid.OUT', 'delivered'));
    expect(msg.status).toBe('failed');
  });
});
