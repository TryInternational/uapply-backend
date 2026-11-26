const request = require('supertest');
const httpStatus = require('http-status');
const app = require('../../src/app');
const setupTestDB = require('../utils/setupTestDB');
const { WhatsappMessage, WhatsappCall } = require('../../src/models');
const { loadSeed } = require('../seed/loadSeed');
const { accessTokenFor } = require('../fixtures/token.fixture');
const { blocked } = require('../utils/blockNetwork');

setupTestDB();

/**
 * Who is told, live, when something happens in WhatsApp.
 *
 * The server tells browsers through a socket. Each signed-in user is in a room
 * of their own, named by their id, and an event is sent to the rooms of the
 * people it concerns. Here the socket server is replaced by one that writes
 * down every event and the room it was sent to, so a test can say who heard
 * what. "Everybody" below means an event sent to every connected browser.
 *
 * The seed's conversations: [0] nobody's, [1] counsellor A's, [2] counsellor
 * B's and linked to a student, [3] counsellor A's and resolved.
 */

const EVERYBODY = '*';

const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const until = async (question, what = 'what was waited for') => {
  const deadline = Date.now() + 5000;
  // eslint-disable-next-line no-await-in-loop
  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    const answer = await question();
    if (answer) return answer;
    // eslint-disable-next-line no-await-in-loop
    await sleep(10);
  }
  throw new Error(`Timed out waiting for ${what}`);
};

const post = (body) => request(app).post('/v1/whatsapp/webhook').send(body).expect(httpStatus.OK);
const event = (field, value) => ({ entry: [{ changes: [{ field, value }] }] });

describe('who is told, live, about WhatsApp', () => {
  let seed;
  let u;
  let c;
  let heard;
  let wamid = 0;

  const as = (user) => {
    const token = `Bearer ${accessTokenFor(user)}`;
    return {
      get: (path) => request(app).get(path).set('Authorization', token),
      post: (path, body = {}) => request(app).post(path).set('Authorization', token).send(body),
    };
  };
  const room = (user) => String(user._id);
  const pathOf = (conversation) => `/v1/whatsapp/conversations/${conversation._id}`;
  /** The rooms an event was sent to, in order and without repeats. */
  const toldOf = (name) => [...new Set(heard.filter((e) => e.event === name).map((e) => e.room))].sort();
  const firstOf = (name) => heard.find((e) => e.event === name);
  const heardWhen = (name) => until(() => firstOf(name), `the event ${name}`);

  /** A message from a number, as Meta posts it; resolves once it is stored. */
  const writesIn = async (waId, name = 'Rana Testwell') => {
    wamid += 1;
    const id = `test.wamid.live.${wamid}`;
    await post(
      event('messages', {
        contacts: [{ profile: { name }, wa_id: waId }],
        messages: [
          { from: waId, id, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'Hello?' } },
        ],
      })
    );
    return until(() => WhatsappMessage.findOne({ waMessageId: id }).lean(), 'the message to be stored');
  };

  beforeEach(async () => {
    seed = await loadSeed();
    u = seed.users;
    c = seed.conversations;
    heard = [];
    app.set('io', {
      to: (name) => ({ emit: (eventName, payload) => heard.push({ room: String(name), event: eventName, payload }) }),
      emit: (eventName, payload) => heard.push({ room: EVERYBODY, event: eventName, payload }),
    });
  });

  afterEach(() => {
    app.set('io', undefined);
  });

  describe('a message coming in', () => {
    test('is told to whoever has the conversation, and to nobody else', async () => {
      const message = await writesIn(c[1].contact.waId);
      const told = await heardWhen('wa:message:new');

      expect(toldOf('wa:message:new')).toEqual([room(u.counsellorA)]);
      expect(told.payload).toMatchObject({
        id: String(message._id),
        direction: 'inbound',
        text: 'Hello?',
        conversation: { id: String(c[1]._id), unreadCount: 3 },
      });
    });

    test('comes with word that the day for writing freely has opened', async () => {
      await writesIn(c[1].contact.waId);
      const told = await heardWhen('wa:conversation:window');

      expect(toldOf('wa:conversation:window')).toEqual([room(u.counsellorA)]);
      expect(told.payload).toMatchObject({ conversationId: String(c[1]._id), status: 'open' });
    });

    test('raises a notification for them as well', async () => {
      await writesIn(c[1].contact.waId);
      const told = await heardWhen('notification');

      expect(toldOf('notification')).toEqual([room(u.counsellorA)]);
      expect(told.payload.message).toMatch(/^New WhatsApp message from /);
    });

    test("from a student's number is told to the student's team", async () => {
      const student = seed.studentsOwnedBy(u.counsellorB).find((s) => s.assignedTo.length);

      await writesIn(String(student.phoneNo).replace(/\D/g, ''));
      await heardWhen('wa:message:new');

      expect(toldOf('wa:message:new')).toEqual(student.assignedTo.map((a) => String(a.user)).sort());
    });
  });

  describe('what we do in a conversation', () => {
    test('a note is told to whoever has the conversation', async () => {
      await as(u.counsellorA)
        .post(`${pathOf(c[1])}/notes`, { text: 'Seed note.' })
        .expect(httpStatus.CREATED);

      expect(toldOf('wa:message:new')).toEqual([room(u.counsellorA)]);
      expect(firstOf('wa:message:new').payload).toMatchObject({ internal: true, text: 'Seed note.' });
    });

    test('somebody named in a note is notified, and the one who wrote it is not', async () => {
      await as(u.counsellorA)
        .post(`${pathOf(c[1])}/notes`, { text: 'Seed note.', mentions: [room(u.counsellorB), room(u.counsellorA)] })
        .expect(httpStatus.CREATED);
      await heardWhen('notification');

      expect(toldOf('notification')).toEqual([room(u.counsellorB)]);
    });

    test('news of a message we sent is told to whoever has the conversation', async () => {
      await writesIn(c[1].contact.waId);
      const sent = await as(u.counsellorA).post(`${pathOf(c[1])}/messages/text`, { text: 'Hello again.' });
      const { waMessageId } = await WhatsappMessage.findById(sent.body.id).lean();

      await post(event('messages', { statuses: [{ id: waMessageId, status: 'delivered' }] }));
      const told = await heardWhen('wa:message:status');

      expect(toldOf('wa:message:status')).toEqual([room(u.counsellorA)]);
      expect(told.payload).toMatchObject({ conversationId: String(c[1]._id), messageId: sent.body.id, status: 'delivered' });
    });

    test('giving it to somebody is told to them, with a notification', async () => {
      await as(u.admin)
        .post(`${pathOf(c[1])}/assign`, {
          assignees: [
            { userId: room(u.counsellorA), role: 'counsellor' },
            { userId: room(u.counsellorB), role: 'counsellor' },
          ],
        })
        .expect(httpStatus.OK);
      await heardWhen('notification');

      expect(toldOf('wa:conversation:assigned')).toEqual([room(u.counsellorA), room(u.counsellorB)].sort());
      expect(toldOf('notification')).toEqual([room(u.counsellorB)]);
    });
  });

  describe('calls', () => {
    const start = async () => {
      const res = await as(u.counsellorA).post(`${pathOf(c[1])}/calls`, { sdpOffer: 'v=0 a made-up offer' });
      return res.body;
    };

    test('a call from a contact rings whoever has the conversation, with what is needed to answer', async () => {
      await post(
        event('calls', {
          calls: [
            {
              id: 'wacid.live.inbound',
              from: c[1].contact.waId,
              direction: 'USER_INITIATED',
              event: 'connect',
              session: { sdp_type: 'offer', sdp: 'v=0 the caller offer' },
            },
          ],
        })
      );
      const told = await heardWhen('wa:call:incoming');

      expect(toldOf('wa:call:incoming')).toEqual([room(u.counsellorA)]);
      expect(told.payload).toMatchObject({
        conversationId: String(c[1]._id),
        status: 'ringing',
        sdpOffer: 'v=0 the caller offer',
      });
    });

    test("the other side's answer to a call we made goes to whoever has the conversation", async () => {
      const call = await start();

      await post(
        event('calls', {
          calls: [{ id: call.waCallId, event: 'connect', session: { sdp_type: 'answer', sdp: 'v=0 their answer' } }],
        })
      );
      const told = await heardWhen('wa:call:sdp');

      expect(toldOf('wa:call:sdp')).toEqual([room(u.counsellorA)]);
      expect(told.payload).toEqual({ callId: call.id, sdpAnswer: 'v=0 their answer' });
      expect(toldOf('wa:call:status')).toEqual([room(u.counsellorA)]);
      expect((await WhatsappCall.findById(call.id).lean()).status).toBe('connecting');
    });

    test('hanging up is told to whoever has the conversation', async () => {
      const call = await start();

      await as(u.counsellorA).post(`/v1/whatsapp/calls/${call.id}/terminate`).expect(httpStatus.OK);

      expect(toldOf('wa:call:status')).toEqual([room(u.counsellorA)]);
      expect(firstOf('wa:call:status').payload).toMatchObject({ callId: call.id, status: 'missed', endReason: 'no_answer' });
    });

    test("a contact's answer about being called is told to whoever has the conversation", async () => {
      await post(
        event('messages', {
          contacts: [{ profile: { name: c[1].contact.name }, wa_id: c[1].contact.waId }],
          messages: [
            {
              from: c[1].contact.waId,
              id: 'test.wamid.live.permission',
              timestamp: String(Math.floor(Date.now() / 1000)),
              type: 'interactive',
              interactive: {
                type: 'call_permission_reply',
                call_permission_reply: { response: 'accept', is_permanent: true },
              },
            },
          ],
        })
      );
      const told = await heardWhen('wa:call:permission');

      expect(toldOf('wa:call:permission')).toEqual([room(u.counsellorA)]);
      expect(told.payload).toEqual({ conversationId: String(c[1]._id), status: 'granted' });
    });
  });

  test('no WhatsApp event is ever sent to the room of a partner', async () => {
    const student = seed.studentsOwnedBy(u.counsellorB).find((s) => s.assignedTo.length);
    await writesIn(c[1].contact.waId);
    await writesIn(String(student.phoneNo).replace(/\D/g, ''));
    await as(u.counsellorA).post(`${pathOf(c[1])}/notes`, { text: 'Seed note.' });
    await heardWhen('wa:conversation:window');
    const partners = [u.subAgentA, u.subAgentB, u.schoolA, u.schoolB].map(room);

    expect(heard.length).toBeGreaterThan(4);
    expect(heard.filter((e) => partners.includes(e.room))).toEqual([]);
    expect(heard.filter((e) => e.room === EVERYBODY)).toEqual([]);
  });

  describe('sending a file from the inbox', () => {
    const upload = (name, type, bytes = 'not really a picture') =>
      request(app)
        .post('/v1/whatsapp/media')
        .set('Authorization', `Bearer ${accessTokenFor(u.counsellorA)}`)
        .attach('file', Buffer.from(bytes), { filename: name, contentType: type });

    test.each([
      ['photo.png', 'image/png', 'image'],
      ['voice.ogg', 'audio/ogg', 'audio'],
      ['offer.pdf', 'application/pdf', 'document'],
    ])('%s is taken in and given back as something to send: %s is sent as %s', async (name, type, kind) => {
      const res = await upload(name, type).expect(httpStatus.CREATED);

      expect(res.body).toMatchObject({ type: kind, mimeType: type, filename: name, size: 'not really a picture'.length });
      expect(res.body.mediaId).toEqual(expect.any(String));
    });

    test('a request with no file is refused', async () => {
      await as(u.counsellorA).post('/v1/whatsapp/media').expect(httpStatus.BAD_REQUEST);
    });
  });

  // How things are today, written down so a change shows up. None of these lets
  // anybody see or change what they should not. When one is changed, its test
  // fails and is rewritten to say what is then true.
  describe('not as one would expect yet', () => {
    test('a message into a conversation nobody has is told to nobody, admins included', async () => {
      await writesIn(c[0].contact.waId);
      await writesIn(c[1].contact.waId);
      await heardWhen('wa:message:new');

      expect(
        heard.filter((e) => e.payload && e.payload.conversation && e.payload.conversation.id === String(c[0]._id))
      ).toEqual([]);
      expect(toldOf('wa:message:new')).toEqual([room(u.counsellorA)]);
    });

    test('a reply we send is not told to the other people on the conversation', async () => {
      await as(u.admin)
        .post(`${pathOf(c[1])}/assign`, {
          assignees: [
            { userId: room(u.counsellorA), role: 'counsellor' },
            { userId: room(u.counsellorB), role: 'counsellor' },
          ],
        })
        .expect(httpStatus.OK);
      await writesIn(c[1].contact.waId);
      await heardWhen('wa:conversation:window');
      heard.length = 0;

      await as(u.counsellorA)
        .post(`${pathOf(c[1])}/messages/text`, { text: 'Hello again.' })
        .expect(httpStatus.CREATED);
      await as(u.counsellorA)
        .post(`${pathOf(c[1])}/messages/template`, { templateName: 'document_request', language: 'en' })
        .expect(httpStatus.CREATED);

      expect(heard).toEqual([]);
    });

    test('the person a conversation is taken from is not told', async () => {
      await as(u.admin)
        .post(`${pathOf(c[1])}/assign`, { assignees: [{ userId: room(u.counsellorB), role: 'counsellor' }] })
        .expect(httpStatus.OK);
      await heardWhen('notification');

      expect(toldOf('wa:conversation:assigned')).toEqual([room(u.counsellorB)]);
      expect(heard.filter((e) => e.room === room(u.counsellorA))).toEqual([]);
    });
  });

  test('none of this tried to reach anything outside the machine', () => {
    expect(blocked).toEqual([]);
  });
});
