const crypto = require('crypto');
const request = require('supertest');
const httpStatus = require('http-status');
const mongoose = require('mongoose');
const app = require('../../src/app');
const config = require('../../src/config/config');
const setupTestDB = require('../utils/setupTestDB');
const { WhatsappConversation, WhatsappMessage, Students, Notifications, Documents } = require('../../src/models');
const { loadSeed } = require('../seed/loadSeed');
const { accessTokenFor } = require('../fixtures/token.fixture');
const { blocked } = require('../utils/blockNetwork');

setupTestDB();

/**
 * The WhatsApp inbox, as staff use it, and the webhook that feeds it.
 *
 * No test here has a WhatsApp credential, so the client for Meta answers as its
 * own stand-in does: every send is given a made-up message id and nothing
 * leaves the machine. What Meta would send us is posted to the webhook by hand.
 *
 * The seed's four conversations: [0] nobody's, [1] counsellor A's with two
 * unread, [2] counsellor B's and linked to a student, [3] counsellor A's and
 * resolved. None has an open 24-hour window until its contact writes in.
 */

const DAY = 24 * 60 * 60 * 1000;
const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

// The webhook answers Meta first and does the work afterwards, so a test waits
// for what it expects to appear.
const until = async (question, what = 'what was waited for') => {
  const deadline = Date.now() + 3000;
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

const digits = (phone) => String(phone).replace(/\D/g, '');
const idsOf = (list) => list.map((record) => String(record.id || record._id));

let wamid = 0;
const nextWamid = () => {
  wamid += 1;
  return `test.wamid.${wamid}`;
};

/** One message from a contact, as Meta posts it. */
const inbound = (from, extra = {}) => {
  const { name = 'Rana Testwell', phoneNumberId, at, ...message } = extra;
  return {
    entry: [
      {
        changes: [
          {
            field: 'messages',
            value: {
              ...(phoneNumberId && { metadata: { phone_number_id: phoneNumberId } }),
              contacts: [{ profile: { name }, wa_id: from }],
              messages: [
                {
                  from,
                  id: nextWamid(),
                  timestamp: String(Math.floor((at || Date.now()) / 1000)),
                  type: 'text',
                  text: { body: 'Hello, I have a question.' },
                  ...message,
                },
              ],
            },
          },
        ],
      },
    ],
  };
};

/** A delivery receipt, as Meta posts it. */
const receipt = (id, status, errors) => ({
  entry: [{ changes: [{ field: 'messages', value: { statuses: [{ id, status, ...(errors && { errors }) }] } }] }],
});

const post = (body) => request(app).post('/v1/whatsapp/webhook').send(body).expect(httpStatus.OK);

describe('the WhatsApp inbox', () => {
  let seed;
  let u;
  let c;
  let startedAt;
  const settings = { ...config.whatsapp };

  const as = (user) => {
    const token = `Bearer ${accessTokenFor(user)}`;
    return {
      get: (path) => request(app).get(path).set('Authorization', token),
      post: (path, body = {}) => request(app).post(path).set('Authorization', token).send(body),
      patch: (path, body = {}) => request(app).patch(path).set('Authorization', token).send(body),
    };
  };

  const stored = (conversation) => WhatsappConversation.findById(conversation.id || conversation._id).lean();
  const messagesOf = (conversation) =>
    WhatsappMessage.find({ conversation: conversation.id || conversation._id })
      .sort({ timestamp: 1 })
      .lean();
  const pathOf = (conversation) => `/v1/whatsapp/conversations/${conversation.id || conversation._id}`;

  /** The contact of a seeded conversation writes in, which opens its window. */
  const writesIn = async (conversation, extra = {}) => {
    const body = inbound(conversation.contact.waId, extra);
    const { id } = body.entry[0].changes[0].value.messages[0];
    await post(body);
    return until(() => WhatsappMessage.findOne({ waMessageId: id }).lean(), 'the message to be stored');
  };

  beforeEach(async () => {
    seed = await loadSeed();
    u = seed.users;
    c = seed.conversations;
    startedAt = Date.now();
  });

  afterEach(() => {
    Object.assign(config.whatsapp, settings);
    Object.keys(config.whatsapp).forEach((key) => {
      // eslint-disable-next-line security/detect-object-injection
      if (!(key in settings)) delete config.whatsapp[key];
    });
  });

  describe('the list of conversations', () => {
    const list = async (user, query = '') => {
      const res = await as(user).get(`/v1/whatsapp/conversations${query}`).expect(httpStatus.OK);
      return res.body;
    };

    test('a counsellor is given their own, newest first', async () => {
      const mine = await list(u.counsellorA);

      expect(idsOf(mine.results)).toEqual(idsOf([c[1], c[3]]));
      expect(mine.totalResults).toBe(2);
    });

    test('a counsellor who asks for everybody else is still given only their own', async () => {
      expect(idsOf((await list(u.counsellorA, '?filter=all')).results)).toEqual(idsOf([c[1], c[3]]));
      expect(idsOf((await list(u.counsellorA, '?filter=unassigned')).results)).toEqual(idsOf([c[1], c[3]]));
    });

    test('an admin can ask for all of them, for the ones nobody has, or for their own', async () => {
      expect(idsOf((await list(u.admin, '?filter=all')).results)).toEqual(idsOf(c));
      expect(idsOf((await list(u.admin, '?filter=unassigned')).results)).toEqual(idsOf([c[0]]));
      expect((await list(u.admin)).results).toEqual([]);
    });

    test('search is by the name or number of the contact, and what is typed is plain text', async () => {
      const byNumber = await list(u.admin, `?filter=all&search=${c[2].contact.waId.slice(-6)}`);
      const byName = await list(u.admin, `?filter=all&search=${encodeURIComponent(c[1].contact.name)}`);
      const pattern = await list(u.admin, `?filter=all&search=${encodeURIComponent('.*')}`);

      expect(idsOf(byNumber.results)).toEqual(idsOf([c[2]]));
      expect(idsOf(byName.results)).toEqual(idsOf([c[1]]));
      expect(pattern.results).toEqual([]);
    });

    test('it comes a page at a time', async () => {
      const first = await list(u.admin, '?filter=all&limit=3&page=1');
      const second = await list(u.admin, '?filter=all&limit=3&page=2');

      expect(first).toMatchObject({ page: 1, limit: 3, totalPages: 2, totalResults: 4 });
      expect(idsOf(first.results)).toEqual(idsOf(c.slice(0, 3)));
      expect(idsOf(second.results)).toEqual(idsOf([c[3]]));
    });

    test('each one says who it is with, who has it, and whether we can write freely', async () => {
      const [one] = (await list(u.counsellorA)).results;

      expect(one).toMatchObject({
        id: String(c[1]._id),
        contact: { phone: c[1].contact.phone, name: c[1].contact.name, waId: c[1].contact.waId },
        assignees: [{ userId: String(u.counsellorA._id), role: 'counsellor' }],
        unreadCount: 2,
        status: 'open',
        priority: 'medium',
        tags: [],
        windowStatus: 'closed',
        windowExpiresAt: null,
      });
      expect(one.student).toBeUndefined();
    });

    test('one linked to a student carries what the contact panel shows about them', async () => {
      const [one] = (await list(u.counsellorB)).results;
      const student = seed.students.find((s) => String(s._id) === String(c[2].student));

      expect(one.id).toBe(String(c[2]._id));
      expect(one.student).toMatchObject({
        id: String(student._id),
        name: `${student.firstName} ${student.lastName}`,
        stage: 'Applied',
        phone: student.phoneNo,
      });
      expect(idsOf(one.student.relatedApplications).sort()).toEqual(idsOf(seed.applicationsOf(student)).sort());
    });

    test('a filter that is not one of the three is refused', async () => {
      await as(u.admin).get('/v1/whatsapp/conversations?filter=everything').expect(httpStatus.BAD_REQUEST);
    });
  });

  describe('starting a conversation', () => {
    const start = (user, body) => as(user).post('/v1/whatsapp/conversations', body);

    test('makes one for the number and puts whoever started it on it', async () => {
      const res = await start(u.counsellorA, { phone: '+965 0990 0001', name: 'Rana Testwell' }).expect(httpStatus.CREATED);

      expect(res.body).toMatchObject({
        contact: { phone: '96509900001', waId: '96509900001', name: 'Rana Testwell' },
        assignees: [{ userId: String(u.counsellorA._id), role: 'counsellor' }],
        windowStatus: 'closed',
        unreadCount: 0,
      });
      expect(await WhatsappConversation.countDocuments()).toBe(c.length + 1);
    });

    test('for a number we already talk to, it is the conversation there is, with the caller added', async () => {
      const res = await start(u.counsellorB, { phone: c[1].contact.phone }).expect(httpStatus.CREATED);

      expect(res.body.id).toBe(String(c[1]._id));
      expect(res.body.assignees.map((a) => a.userId)).toEqual([String(u.counsellorA._id), String(u.counsellorB._id)]);
      expect(await WhatsappConversation.countDocuments()).toBe(c.length);
    });

    test("for a student's number, it is linked to the student and given to their team as well", async () => {
      const student = seed.studentsOwnedBy(u.counsellorB).find((s) => s.assignedTo.length);
      const res = await start(u.counsellorA, { phone: student.phoneNo }).expect(httpStatus.CREATED);

      expect(res.body.student.id).toBe(String(student._id));
      expect(res.body.assignees.map((a) => a.userId)).toEqual([
        ...student.assignedTo.map((a) => String(a.user)),
        String(u.counsellorA._id),
      ]);
    });

    test('a number too short to carry a country code is refused', async () => {
      await start(u.counsellorA, { phone: '+1 23 45' }).expect(httpStatus.BAD_REQUEST);
      await start(u.counsellorA, { phone: '1234' }).expect(httpStatus.BAD_REQUEST);
      await start(u.counsellorA, {}).expect(httpStatus.BAD_REQUEST);

      expect(await WhatsappConversation.countDocuments()).toBe(c.length);
    });
  });

  describe('the messages of a conversation', () => {
    const page = async (query = '') => {
      const res = await as(u.counsellorA)
        .get(`${pathOf(c[1])}/messages${query}`)
        .expect(httpStatus.OK);
      return res.body;
    };

    test('come oldest first, each saying which way it went', async () => {
      const { messages, nextCursor } = await page();

      expect(messages.map((m) => [m.direction, m.internal === true])).toEqual([
        ['inbound', false],
        ['outbound', false],
        ['outbound', true],
      ]);
      expect(messages[1]).toMatchObject({
        conversationId: String(c[1]._id),
        status: 'read',
        sentByUserId: String(u.counsellorA._id),
      });
      expect(nextCursor).toBeUndefined();
    });

    test('older ones are fetched with the cursor the page gives', async () => {
      const latest = await page('?limit=2');
      const older = await page(`?limit=2&before=${encodeURIComponent(latest.nextCursor)}`);

      expect(latest.messages).toHaveLength(2);
      expect(latest.nextCursor).toBe(latest.messages[0].timestamp);
      expect(older.messages).toHaveLength(1);
      expect(older.messages[0].direction).toBe('inbound');
      expect(older.nextCursor).toBeUndefined();
    });

    test('a conversation id that is not an id is refused', async () => {
      await as(u.counsellorA).get('/v1/whatsapp/conversations/not-an-id/messages').expect(httpStatus.BAD_REQUEST);
    });
  });

  describe('writing to a contact', () => {
    const text = (conversation, body) => as(u.counsellorA).post(`${pathOf(conversation)}/messages/text`, body);

    test('more than a day after they last wrote, free text is refused and nothing is stored', async () => {
      const res = await text(c[1], { text: 'Hello again.' }).expect(httpStatus.CONFLICT);

      expect(res.body).toEqual({ code: 'WINDOW_CLOSED' });
      expect(await messagesOf(c[1])).toHaveLength(3);
    });

    test('once they have written, free text goes out and is recorded as sent by the caller', async () => {
      await writesIn(c[1]);

      const res = await text(c[1], { text: 'Hello again.', clientRef: 'ref-1' }).expect(httpStatus.CREATED);

      expect(res.body).toMatchObject({
        conversationId: String(c[1]._id),
        direction: 'outbound',
        type: 'text',
        text: 'Hello again.',
        status: 'sent',
        clientRef: 'ref-1',
        sentByUserId: String(u.counsellorA._id),
      });
      const message = await WhatsappMessage.findById(res.body.id).lean();
      expect(message.waMessageId).toEqual(expect.any(String));
      expect(message.internal).toBe(false);
      expect((await stored(c[1])).lastMessage).toMatchObject({ preview: 'Hello again.', direction: 'outbound' });
    });

    test('text that is empty is refused, and a conversation that does not exist is 404', async () => {
      await writesIn(c[1]);

      await text(c[1], { text: '' }).expect(httpStatus.BAD_REQUEST);
      await text(c[1], {}).expect(httpStatus.BAD_REQUEST);
      await text({ _id: new mongoose.Types.ObjectId() }, { text: 'Hello.' }).expect(httpStatus.NOT_FOUND);
    });

    test('a template goes out whether they have written or not, with its blanks filled in', async () => {
      const res = await as(u.counsellorA)
        .post(`${pathOf(c[1])}/messages/template`, {
          templateName: 'document_request',
          language: 'en',
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: 'Rana' },
                { type: 'text', text: 'passport copy' },
              ],
            },
          ],
        })
        .expect(httpStatus.CREATED);

      expect(res.body).toMatchObject({
        direction: 'outbound',
        type: 'template',
        template: { name: 'document_request', language: 'en' },
        text: 'Hello Rana, we still need your passport copy to move your application forward. Please share it when you can.',
        status: 'sent',
      });
      expect((await stored(c[1])).lastMessage.direction).toBe('outbound');
    });

    test('a template needs its name and language', async () => {
      await as(u.counsellorA)
        .post(`${pathOf(c[1])}/messages/template`, { templateName: 'document_request' })
        .expect(httpStatus.BAD_REQUEST);
      await as(u.counsellorA)
        .post(`${pathOf(c[1])}/messages/template`, { language: 'en' })
        .expect(httpStatus.BAD_REQUEST);
    });

    test('a file is held to the same day as free text', async () => {
      const file = {
        mediaId: 'https://example.com/files/offer.pdf',
        type: 'document',
        filename: 'offer.pdf',
        caption: 'Offer',
      };

      const closed = await as(u.counsellorA)
        .post(`${pathOf(c[1])}/messages/media`, file)
        .expect(httpStatus.CONFLICT);
      expect(closed.body).toEqual({ code: 'WINDOW_CLOSED' });

      await writesIn(c[1]);
      const res = await as(u.counsellorA)
        .post(`${pathOf(c[1])}/messages/media`, file)
        .expect(httpStatus.CREATED);

      expect(res.body).toMatchObject({
        type: 'document',
        text: 'Offer',
        media: { mediaId: file.mediaId, url: file.mediaId, type: 'document', filename: 'offer.pdf' },
      });
    });

    test('a file of a kind WhatsApp does not carry is refused', async () => {
      await writesIn(c[1]);

      await as(u.counsellorA)
        .post(`${pathOf(c[1])}/messages/media`, { mediaId: 'https://example.com/a.mp4', type: 'video' })
        .expect(httpStatus.BAD_REQUEST);
    });

    test('the templates offered are the approved ones', async () => {
      const res = await as(u.counsellorA).get('/v1/whatsapp/templates').expect(httpStatus.OK);

      expect(res.body.map((t) => t.name)).toEqual(['appointment_reminder', 'document_request', 'welcome_followup']);
      expect(res.body.every((t) => t.status === 'APPROVED' && t.language === 'en')).toBe(true);
      expect(res.body[1].components[0]).toMatchObject({ type: 'BODY', example: ['Maria', 'passport copy'] });
    });
  });

  describe('a note for the team', () => {
    const note = (user, body) => as(user).post(`${pathOf(c[1])}/notes`, body);

    test('is kept with the conversation and is not sent to the contact', async () => {
      const res = await note(u.counsellorA, { text: 'Seed note: call back on Sunday.' }).expect(httpStatus.CREATED);

      expect(res.body).toMatchObject({
        internal: true,
        text: 'Seed note: call back on Sunday.',
        sentByUserId: String(u.counsellorA._id),
      });
      const message = await WhatsappMessage.findById(res.body.id).lean();
      expect(message.waMessageId).toBeUndefined();
    });

    test('tops the list without counting as an answer to the contact', async () => {
      await note(u.counsellorA, { text: 'Seed note.' }).expect(httpStatus.CREATED);

      const now = await stored(c[1]);
      expect(now.lastMessage).toMatchObject({ preview: '📝 Internal note', direction: 'inbound' });
      expect(now.lastMessageAt.getTime()).toBeGreaterThanOrEqual(startedAt);
    });

    test('tells the people named in it, and not the one who wrote it', async () => {
      await note(u.counsellorA, {
        text: 'Seed note: can you take this one?',
        mentions: [String(u.counsellorB._id), String(u.counsellorA._id)],
      }).expect(httpStatus.CREATED);

      const told = await Notifications.find({ type: 'whatsapp' }).lean();
      expect(told).toHaveLength(1);
      expect(told[0].userIds.map(String)).toEqual([String(u.counsellorB._id)]);
      expect(told[0].message).toContain(`${u.counsellorA.name} mentioned you in a note`);
      expect(String(told[0].conversationId)).toBe(String(c[1]._id));
    });

    test('needs some text, and names that are ids', async () => {
      await note(u.counsellorA, {}).expect(httpStatus.BAD_REQUEST);
      await note(u.counsellorA, { text: 'Seed note.', mentions: ['somebody'] }).expect(httpStatus.BAD_REQUEST);
    });
  });

  test('marking a conversation read clears its unread count', async () => {
    const res = await as(u.counsellorA)
      .post(`${pathOf(c[1])}/read`)
      .expect(httpStatus.OK);

    expect(res.body).toEqual({ unreadCount: 0 });
    expect((await stored(c[1])).unreadCount).toBe(0);
  });

  describe('giving a conversation to somebody', () => {
    const assign = (conversation, assignees) => as(u.admin).post(`${pathOf(conversation)}/assign`, { assignees });

    test('replaces who has it, and tells whoever is new', async () => {
      const res = await assign(c[1], [
        { userId: String(u.counsellorA._id), role: 'counsellor' },
        { userId: String(u.counsellorB._id), role: 'counsellor' },
      ]).expect(httpStatus.OK);

      expect(res.body.assignees.map((a) => a.userId)).toEqual([String(u.counsellorA._id), String(u.counsellorB._id)]);
      const told = await Notifications.find({ type: 'whatsapp' }).lean();
      expect(told).toHaveLength(1);
      expect(told[0].userIds.map(String)).toEqual([String(u.counsellorB._id)]);
      expect(told[0].message).toContain('You were assigned to');
      expect(String(told[0].createdBy)).toBe(String(u.admin._id));
    });

    test('it then shows in the new owner list and not in the old one', async () => {
      await assign(c[1], [{ userId: String(u.counsellorB._id), role: 'counsellor' }]).expect(httpStatus.OK);

      const theirs = await as(u.counsellorB).get('/v1/whatsapp/conversations').expect(httpStatus.OK);
      const mine = await as(u.counsellorA).get('/v1/whatsapp/conversations').expect(httpStatus.OK);
      expect(idsOf(theirs.body.results)).toEqual(idsOf([c[1], c[2]]));
      expect(idsOf(mine.body.results)).toEqual(idsOf([c[3]]));
    });

    test("for a conversation linked to a student, the student's team becomes the same people", async () => {
      await assign(c[2], [{ userId: String(u.counsellorA._id), role: 'sales' }]).expect(httpStatus.OK);

      const student = await Students.findById(c[2].student).lean();
      expect(student.assignedTo).toHaveLength(1);
      expect(String(student.assignedTo[0].user)).toBe(String(u.counsellorA._id));
      expect(student.assignedTo[0].role).toBe('sales');
    });

    test('an empty list takes it off everybody', async () => {
      const res = await assign(c[1], []).expect(httpStatus.OK);

      expect(res.body.assignees).toEqual([]);
      const nobodys = await as(u.admin).get('/v1/whatsapp/conversations?filter=unassigned').expect(httpStatus.OK);
      expect(idsOf(nobodys.body.results)).toEqual(idsOf([c[0], c[1]]));
    });

    test('needs a list, of people given by id with a role', async () => {
      await as(u.admin)
        .post(`${pathOf(c[1])}/assign`, {})
        .expect(httpStatus.BAD_REQUEST);
      await assign(c[1], [{ userId: 'somebody', role: 'counsellor' }]).expect(httpStatus.BAD_REQUEST);
      await assign(c[1], [{ userId: String(u.counsellorB._id) }]).expect(httpStatus.BAD_REQUEST);
      await assign({ _id: new mongoose.Types.ObjectId() }, []).expect(httpStatus.NOT_FOUND);

      expect((await stored(c[1])).assignees).toHaveLength(1);
    });
  });

  describe('sorting a conversation out', () => {
    const change = (conversation, body) => as(u.counsellorA).patch(pathOf(conversation), body);

    test('resolving it stamps when, and reopening it clears that', async () => {
      const resolved = await change(c[1], { status: 'resolved' }).expect(httpStatus.OK);

      expect(resolved.body.status).toBe('resolved');
      expect(new Date(resolved.body.resolvedAt).getTime()).toBeGreaterThanOrEqual(startedAt);

      const reopened = await change(c[1], { status: 'open' }).expect(httpStatus.OK);

      expect(reopened.body).toMatchObject({ status: 'open', resolvedAt: null });
    });

    test('resolving one that is resolved leaves the time it was resolved', async () => {
      const res = await change(c[3], { status: 'resolved' }).expect(httpStatus.OK);

      expect(res.body.resolvedAt).toBe(c[3].resolvedAt.toISOString());
    });

    test('its priority, tags and follow-up date are set, and what is not sent is left', async () => {
      await change(c[1], { priority: 'high', tags: ['visa', 'urgent'] }).expect(httpStatus.OK);
      const res = await change(c[1], { nextFollowUpAt: '2026-02-01T09:00:00.000Z' }).expect(httpStatus.OK);

      expect(res.body).toMatchObject({
        priority: 'high',
        tags: ['visa', 'urgent'],
        nextFollowUpAt: '2026-02-01T09:00:00.000Z',
        status: 'open',
      });
      const cleared = await change(c[1], { nextFollowUpAt: null }).expect(httpStatus.OK);
      expect(cleared.body.nextFollowUpAt).toBeNull();
    });

    test("the contact's name can be set by hand, and cleared", async () => {
      const named = await change(c[1], { contactName: '  Rana Testwell  ' }).expect(httpStatus.OK);
      expect(named.body.contact.name).toBe('Rana Testwell');

      const cleared = await change(c[1], { contactName: '' }).expect(httpStatus.OK);
      expect(cleared.body.contact.name).toBeUndefined();
      expect((await stored(c[1])).contact.phone).toBe(c[1].contact.phone);
    });

    test('linking it to a student gives it to their team when nobody has it', async () => {
      const student = seed.studentsOwnedBy(u.counsellorB).find((s) => s.assignedTo.length);

      const res = await as(u.admin)
        .patch(pathOf(c[0]), { studentId: String(student._id) })
        .expect(httpStatus.OK);

      expect(res.body.student.id).toBe(String(student._id));
      expect(res.body.assignees.map((a) => a.userId)).toEqual(student.assignedTo.map((a) => String(a.user)));
    });

    test('linking one that somebody has leaves it with them', async () => {
      const student = seed.studentsOwnedBy(u.counsellorB).find((s) => s.assignedTo.length);

      const res = await change(c[1], { studentId: String(student._id) }).expect(httpStatus.OK);

      expect(res.body.student.id).toBe(String(student._id));
      expect(res.body.assignees.map((a) => a.userId)).toEqual([String(u.counsellorA._id)]);
    });

    test('a status, priority or student that does not exist is refused', async () => {
      await change(c[1], { status: 'closed' }).expect(httpStatus.BAD_REQUEST);
      await change(c[1], { priority: 'urgent' }).expect(httpStatus.BAD_REQUEST);
      await change(c[1], { studentId: String(new mongoose.Types.ObjectId()) }).expect(httpStatus.NOT_FOUND);
      await change({ _id: new mongoose.Types.ObjectId() }, { priority: 'low' }).expect(httpStatus.NOT_FOUND);

      expect(await stored(c[1])).toMatchObject({ status: 'open', priority: 'medium' });
    });
  });

  describe('what arrives from WhatsApp', () => {
    const NUMBER = '96509900002';
    const conversationOf = (number) => WhatsappConversation.findOne({ 'contact.waId': number }).lean();

    test('a message from a number we have not seen starts a conversation nobody has', async () => {
      await post(inbound(NUMBER));
      const conversation = await until(() => conversationOf(NUMBER), 'the conversation');

      expect(conversation).toMatchObject({
        contact: { phone: NUMBER, waId: NUMBER, name: 'Rana Testwell' },
        assignees: [],
        unreadCount: 1,
        status: 'open',
        lastMessage: { preview: 'Hello, I have a question.', direction: 'inbound' },
      });
      expect(conversation.student).toBeUndefined();
      const [message] = await messagesOf(conversation);
      expect(message).toMatchObject({ direction: 'inbound', type: 'text', status: 'delivered' });
    });

    test('it opens a day in which we can write freely', async () => {
      await post(inbound(NUMBER));
      const conversation = await until(() => conversationOf(NUMBER), 'the conversation');

      const opensFor = conversation.windowExpiresAt.getTime() - startedAt;
      expect(opensFor).toBeGreaterThanOrEqual(DAY);
      expect(opensFor).toBeLessThan(DAY + 60 * 1000);
      const res = await as(u.admin).get(pathOf(conversation)).expect(httpStatus.OK);
      expect(res.body.windowStatus).toBe('open');
    });

    test("a message from a student's number is linked to the student and given to their team", async () => {
      const student = seed.studentsOwnedBy(u.counsellorB).find((s) => s.assignedTo.length);
      const number = digits(student.phoneNo);

      await post(inbound(number));
      const conversation = await until(() => conversationOf(number), 'the conversation');

      expect(String(conversation.student)).toBe(String(student._id));
      expect(conversation.assignees.map((a) => String(a.userId))).toEqual(student.assignedTo.map((a) => String(a.user)));
      const told = await until(() => Notifications.findOne({ type: 'whatsapp' }).lean(), 'the notification');
      expect(told.userIds.map(String)).toEqual(student.assignedTo.map((a) => String(a.user)));
      expect(String(told.studentId)).toBe(String(student._id));
    });

    test('a further message goes into the same conversation and adds to what is unread', async () => {
      await writesIn(c[1]);
      await writesIn(c[1], { text: { body: 'Are you there?' } });

      const now = await stored(c[1]);
      expect(now.unreadCount).toBe(4);
      expect(now.lastMessage.preview).toBe('Are you there?');
      expect(await WhatsappConversation.countDocuments()).toBe(c.length);
      expect(await messagesOf(c[1])).toHaveLength(5);
    });

    test('the same message delivered twice is stored once', async () => {
      const body = inbound(NUMBER);

      await post(body);
      await until(() => conversationOf(NUMBER), 'the conversation');
      await post(body);
      await writesIn(await conversationOf(NUMBER), { text: { body: 'A second message.' } });

      const conversation = await conversationOf(NUMBER);
      expect(await messagesOf(conversation)).toHaveLength(2);
      expect(conversation.unreadCount).toBe(2);
    });

    test('a photo is stored as a photo, with what was written under it', async () => {
      await post(
        inbound(NUMBER, {
          type: 'image',
          text: undefined,
          image: { id: 'media-1', mime_type: 'image/jpeg', caption: 'My passport' },
        })
      );
      const conversation = await until(() => conversationOf(NUMBER), 'the conversation');

      const [message] = await messagesOf(conversation);
      expect(message).toMatchObject({
        type: 'image',
        text: 'My passport',
        media: { mediaId: 'media-1', mimeType: 'image/jpeg', type: 'image' },
      });
    });

    test('a kind of message the inbox does not show is kept as a line saying what it was', async () => {
      await post(inbound(NUMBER, { type: 'reaction', text: undefined, reaction: { emoji: '👍' } }));
      const conversation = await until(() => conversationOf(NUMBER), 'the conversation');

      const [message] = await messagesOf(conversation);
      expect(message).toMatchObject({ type: 'system', text: '[reaction]' });
    });

    describe('news of a message we sent', () => {
      let sent;
      const statusOf = async () => (await WhatsappMessage.findById(sent.id).lean()).status;
      const told = async (status, errors) => {
        const { waMessageId } = await WhatsappMessage.findById(sent.id).lean();
        await post(receipt(waMessageId, status, errors));
        // A receipt that is ignored changes nothing, so there is nothing to wait
        // for: a second, different message is used as the marker that the
        // webhook has caught up.
        await writesIn(c[1], { text: { body: `after ${status}` } });
      };

      beforeEach(async () => {
        await writesIn(c[1]);
        const res = await as(u.counsellorA).post(`${pathOf(c[1])}/messages/text`, { text: 'Hello again.' });
        sent = res.body;
      });

      test('moves it from sent to delivered to read', async () => {
        expect(await statusOf()).toBe('sent');
        await told('delivered');
        expect(await statusOf()).toBe('delivered');
        await told('read');
        expect(await statusOf()).toBe('read');
      });

      test('never moves it back, whatever order the news arrives in', async () => {
        await told('read');
        await told('delivered');
        await told('sent');

        expect(await statusOf()).toBe('read');
      });

      test('a failure is recorded with its reason, even after a delivery', async () => {
        await told('delivered');
        await told('failed', [{ code: 131026, title: 'Message undeliverable' }]);

        const message = await WhatsappMessage.findById(sent.id).lean();
        expect(message.status).toBe('failed');
        expect(message.error).toMatchObject({ code: '131026', title: 'Message undeliverable' });
      });

      test('news of a message we do not hold changes nothing', async () => {
        await post(receipt('wamid.nobody', 'read'));
        await writesIn(c[1], { text: { body: 'after' } });

        expect(await statusOf()).toBe('sent');
      });
    });

    describe('when our own number is configured', () => {
      beforeEach(() => {
        config.whatsapp.phoneNumberId = 'seed-number-id';
      });

      test('an event that names another number is left alone', async () => {
        await post(inbound(NUMBER, { phoneNumberId: 'some-other-number' }));
        await post(inbound('96509900003', { phoneNumberId: 'seed-number-id' }));
        await until(() => conversationOf('96509900003'), 'the conversation for our number');

        expect(await conversationOf(NUMBER)).toBeNull();
        expect(await WhatsappConversation.countDocuments()).toBe(c.length + 1);
      });

      test('an event that names no number is taken', async () => {
        await post(inbound(NUMBER));

        expect(await until(() => conversationOf(NUMBER), 'the conversation')).not.toBeNull();
      });
    });
  });

  describe('who is waiting for an answer', () => {
    const NUMBER = '96509900004';
    const waitingOf = async (number) => {
      const conversation = await WhatsappConversation.findOne({ 'contact.waId': number }).lean();
      const res = await as(u.admin).get(pathOf(conversation)).expect(httpStatus.OK);
      return res.body;
    };
    const writes = async (at, body) => {
      const event = inbound(NUMBER, { at, text: { body } });
      const { id } = event.entry[0].changes[0].value.messages[0];
      await post(event);
      await until(() => WhatsappMessage.findOne({ waMessageId: id }).lean(), 'the message to be stored');
    };

    test('a contact who has written twice has been waiting since the first message', async () => {
      const first = startedAt - 3 * 60 * 60 * 1000;
      await writes(first, 'Hello?');
      await writes(first + 2 * 60 * 60 * 1000, 'Anybody there?');

      const now = await waitingOf(NUMBER);
      expect(now.waitingSince).toBe(new Date(Math.floor(first / 1000) * 1000).toISOString());
      expect(now.unanswered).toBe(2);
    });

    test('an answer ends the wait, and a note for the team does not', async () => {
      await writes(startedAt - 60 * 60 * 1000, 'Hello?');
      const conversation = await WhatsappConversation.findOne({ 'contact.waId': NUMBER }).lean();

      await as(u.admin)
        .post(`${pathOf(conversation)}/notes`, { text: 'Seed note.' })
        .expect(httpStatus.CREATED);
      expect((await waitingOf(NUMBER)).unanswered).toBe(1);

      await as(u.admin)
        .post(`${pathOf(conversation)}/messages/text`, { text: 'Hello, how can we help?' })
        .expect(httpStatus.CREATED);
      const answered = await waitingOf(NUMBER);
      expect(answered.waitingSince).toBeNull();
      expect(answered.unanswered).toBeUndefined();
    });

    test('after an answer, the wait starts again from their next message', async () => {
      await writes(startedAt - 2 * 60 * 60 * 1000, 'Hello?');
      const conversation = await WhatsappConversation.findOne({ 'contact.waId': NUMBER }).lean();
      await as(u.admin)
        .post(`${pathOf(conversation)}/messages/text`, { text: 'Hello, how can we help?' })
        .expect(httpStatus.CREATED);
      const next = Date.now() + 5000;
      await writes(next, 'One more question.');

      const now = await waitingOf(NUMBER);
      expect(now.waitingSince).toBe(new Date(Math.floor(next / 1000) * 1000).toISOString());
      expect(now.unanswered).toBe(1);
    });

    test('a resolved conversation is not waiting', async () => {
      const res = await as(u.counsellorA).get(pathOf(c[3])).expect(httpStatus.OK);

      expect(res.body.waitingSince).toBeNull();
      expect(res.body.unanswered).toBeUndefined();
    });
  });

  describe('the webhook itself', () => {
    const SECRET = 'a-secret-made-up-for-this-test';
    const signed = (body, secret = SECRET) => {
      const raw = JSON.stringify(body);
      const signature = `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;
      return request(app)
        .post('/v1/whatsapp/webhook')
        .set('Content-Type', 'application/json')
        .set('X-Hub-Signature-256', signature)
        .send(raw);
    };
    const handshake = (token) =>
      request(app).get(`/v1/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=1158201444`);

    describe('with an app secret configured', () => {
      beforeEach(() => {
        config.whatsapp.appSecret = SECRET;
      });

      test('an event signed with it is taken', async () => {
        await signed(inbound('96509900005')).expect(httpStatus.OK);

        await until(() => WhatsappConversation.findOne({ 'contact.waId': '96509900005' }).lean(), 'the conversation');
      });

      test('an event that is unsigned, or signed with something else, is refused and nothing is stored', async () => {
        await request(app).post('/v1/whatsapp/webhook').send(inbound('96509900005')).expect(httpStatus.FORBIDDEN);
        await signed(inbound('96509900005'), 'another-secret').expect(httpStatus.FORBIDDEN);
        await request(app)
          .post('/v1/whatsapp/webhook')
          .set('X-Hub-Signature-256', 'sha256=nonsense')
          .send(inbound('96509900005'))
          .expect(httpStatus.FORBIDDEN);
        // a signed one after them, so that anything the refused ones started
        // would have been stored by the time this one is
        await signed(inbound('96509900006')).expect(httpStatus.OK);
        await until(() => WhatsappConversation.findOne({ 'contact.waId': '96509900006' }).lean(), 'the conversation');

        expect(await WhatsappConversation.findOne({ 'contact.waId': '96509900005' })).toBeNull();
      });
    });

    describe("Meta's check that the address is ours", () => {
      test('is answered with the challenge when the token is the one configured', async () => {
        config.whatsapp.webhookVerifyToken = 'a-token-made-up-for-this-test';

        const res = await handshake('a-token-made-up-for-this-test').expect(httpStatus.OK);

        expect(res.text).toBe('1158201444');
      });

      test('is refused for any other token, and for every token when none is configured', async () => {
        config.whatsapp.webhookVerifyToken = 'a-token-made-up-for-this-test';
        await handshake('another-token').expect(httpStatus.FORBIDDEN);
        await request(app).get('/v1/whatsapp/webhook?hub.mode=subscribe&hub.challenge=1').expect(httpStatus.FORBIDDEN);

        config.whatsapp.webhookVerifyToken = undefined;
        await handshake('undefined').expect(httpStatus.FORBIDDEN);
        await handshake('').expect(httpStatus.FORBIDDEN);
      });
    });
  });

  describe('keeping a file a contact sent', () => {
    let photo;
    const keep = (message, body = { docTypeKey: 'passport', label: 'Passport' }) =>
      as(u.counsellorB).post(`/v1/whatsapp/messages/${message._id}/save-document`, body);
    const received = (conversation, extra = {}) =>
      WhatsappMessage.create({
        conversation: conversation._id,
        waMessageId: nextWamid(),
        direction: 'inbound',
        type: 'image',
        media: { mediaId: 'media-1', url: 'https://example.com/files/passport.jpg', mimeType: 'image/jpeg', type: 'image' },
        status: 'delivered',
        timestamp: new Date('2026-01-10T09:00:00.000Z'),
        ...extra,
      });

    beforeEach(async () => {
      photo = await received(c[2]);
    });

    test('puts it on the student record as a received document, and marks the message', async () => {
      const res = await keep(photo).expect(httpStatus.CREATED);

      expect(res.body.message.savedDocument).toMatchObject({ label: 'Passport', docTypeKey: 'passport' });
      const document = await Documents.findById(res.body.message.savedDocument.id).lean();
      expect(String(document.studentId)).toBe(String(c[2].student));
      expect(document).toMatchObject({
        docTypeKey: 'passport',
        documentType: 'Passport',
        docState: 'Received',
        tag: { source: 'whatsapp', messageId: String(photo._id), savedBy: String(u.counsellorB._id) },
      });
      expect(document.blobInfo[0]).toMatchObject({
        blobUrl: 'https://example.com/files/passport.jpg',
        fileName: 'whatsapp-image-2026-01-10.jpg',
      });
    });

    test('cannot be done twice for the same file', async () => {
      await keep(photo).expect(httpStatus.CREATED);
      const again = await keep(photo).expect(httpStatus.CONFLICT);

      expect(again.body.errorCode).toBe('ALREADY_SAVED');
      expect(await Documents.countDocuments({ 'tag.source': 'whatsapp' })).toBe(1);
    });

    test('needs the conversation to be linked to a student', async () => {
      const unlinked = await received(c[1]);

      const res = await keep(unlinked).expect(httpStatus.CONFLICT);

      expect(res.body.errorCode).toBe('NOT_LINKED');
    });

    test('is only for a photo or document the contact sent', async () => {
      const ours = await received(c[2], { direction: 'outbound' });
      const voice = await received(c[2], { type: 'audio', media: { mediaId: 'media-2', url: 'https://example.com/a.ogg' } });
      const words = (await messagesOf(c[2])).find((m) => m.type === 'text' && m.direction === 'inbound');

      await keep(ours).expect(httpStatus.BAD_REQUEST);
      await keep(voice).expect(httpStatus.BAD_REQUEST);
      await keep(words).expect(httpStatus.BAD_REQUEST);
      await keep({ _id: new mongoose.Types.ObjectId() }).expect(httpStatus.NOT_FOUND);
      await keep(photo, { label: 'Passport' }).expect(httpStatus.BAD_REQUEST);

      expect(await Documents.countDocuments({ 'tag.source': 'whatsapp' })).toBe(0);
    });
  });

  describe('the set-up page', () => {
    test('says what is configured without showing any of it', async () => {
      const secrets = {
        token: 'made-up-token-value',
        appSecret: 'made-up-app-secret-value',
        webhookVerifyToken: 'made-up-verify-token-value',
      };
      Object.assign(config.whatsapp, secrets);

      const res = await as(u.staff).get('/v1/whatsapp/integration').expect(httpStatus.OK);

      expect(res.body.checklist).toMatchObject({ accessToken: true, appSecret: true, webhookVerifyToken: true });
      expect(res.body.mode).toBe('stub');
      expect(res.body.webhook.callbackUrl).toMatch(/\/v1\/whatsapp\/webhook$/);
      Object.values(secrets).forEach((value) => expect(res.text).not.toContain(value));
    });

    test('lists what is missing', async () => {
      Object.assign(config.whatsapp, { token: undefined, appSecret: undefined, phoneNumberId: undefined });

      const res = await as(u.staff).get('/v1/whatsapp/integration').expect(httpStatus.OK);

      expect(res.body.missing).toEqual(expect.arrayContaining(['phoneNumberId', 'accessToken', 'appSecret']));
    });

    test('registering the number and reading its status are for admins', async () => {
      await as(u.staff).get('/v1/whatsapp/integration/phone').expect(httpStatus.FORBIDDEN);
      await as(u.staff).post('/v1/whatsapp/integration/phone/register', { pin: '123456' }).expect(httpStatus.FORBIDDEN);
      await as(u.staff).get('/v1/whatsapp/integration/calling').expect(httpStatus.FORBIDDEN);
      await as(u.staff).post('/v1/whatsapp/integration/calling/enable').expect(httpStatus.FORBIDDEN);

      await as(u.admin).get('/v1/whatsapp/integration/phone').expect(httpStatus.OK);
      await as(u.admin).post('/v1/whatsapp/integration/phone/register', { pin: '12345' }).expect(httpStatus.BAD_REQUEST);
      const res = await as(u.admin).post('/v1/whatsapp/integration/phone/register', { pin: '123456' }).expect(httpStatus.OK);
      expect(res.body.registered).toBe(true);
    });
  });

  test('the inbox is for staff: partners and callers with no token are refused', async () => {
    await request(app).get('/v1/whatsapp/conversations').expect(httpStatus.UNAUTHORIZED);
    await request(app)
      .post(`${pathOf(c[1])}/messages/template`)
      .send({})
      .expect(httpStatus.UNAUTHORIZED);
    await as(u.subAgentA).get('/v1/whatsapp/conversations').expect(httpStatus.FORBIDDEN);
    await as(u.schoolA).get(pathOf(c[1])).expect(httpStatus.FORBIDDEN);
    await as(u.subAgentA)
      .post(`${pathOf(c[1])}/notes`, { text: 'Seed note.' })
      .expect(httpStatus.FORBIDDEN);
  });

  // How things are today, written down so a change shows up. None of these lets
  // anybody see or change what they should not. When one is changed, its test
  // fails and is rewritten to say what is then true.
  describe('not as one would expect yet', () => {
    test('the list accepts a status to filter by, and does not filter by it', async () => {
      const res = await as(u.admin).get('/v1/whatsapp/conversations?filter=all&status=closed').expect(httpStatus.OK);

      expect(idsOf(res.body.results)).toEqual(idsOf(c));
    });

    test('a conversation can be given to somebody who does not exist', async () => {
      const nobody = String(new mongoose.Types.ObjectId());

      const res = await as(u.admin)
        .post(`${pathOf(c[1])}/assign`, { assignees: [{ userId: nobody, role: 'counsellor' }] })
        .expect(httpStatus.OK);

      expect(res.body.assignees).toEqual([{ userId: nobody, role: 'counsellor' }]);
    });

    test("giving a linked conversation to nobody empties the student's team as well", async () => {
      await as(u.admin)
        .post(`${pathOf(c[2])}/assign`, { assignees: [] })
        .expect(httpStatus.OK);

      expect((await Students.findById(c[2].student).lean()).assignedTo).toEqual([]);
    });

    test('a template that does not exist is recorded as sent, with nothing in it', async () => {
      const res = await as(u.counsellorA)
        .post(`${pathOf(c[1])}/messages/template`, { templateName: 'no_such_template', language: 'en' })
        .expect(httpStatus.CREATED);

      expect(res.body.status).toBe('sent');
      expect(res.body.text).toBeUndefined();
    });
  });

  test('none of this tried to reach anything outside the machine', () => {
    expect(blocked).toEqual([]);
  });
});
