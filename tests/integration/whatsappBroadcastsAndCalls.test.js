const request = require('supertest');
const httpStatus = require('http-status');
const mongoose = require('mongoose');
const app = require('../../src/app');
const setupTestDB = require('../utils/setupTestDB');
const { WhatsappBroadcast, WhatsappCall, WhatsappConversation, WhatsappMessage, Students } = require('../../src/models');
const { loadSeed } = require('../seed/loadSeed');
const { build } = require('../factories');
const { accessTokenFor } = require('../fixtures/token.fixture');
const { blocked } = require('../utils/blockNetwork');

setupTestDB();

/**
 * WhatsApp broadcasts and calls.
 *
 * As in the inbox tests, no test here has a WhatsApp credential: the client for
 * Meta answers as its own stand-in does, and what Meta would send us is posted
 * to the webhook by hand.
 *
 * A broadcast is sent after the request is answered, a recipient at a time, so
 * a test waits for it to finish before looking at what it did.
 */

const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const until = async (question, what = 'what was waited for') => {
  const deadline = Date.now() + 8000;
  // eslint-disable-next-line no-await-in-loop
  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    const answer = await question();
    if (answer) return answer;
    // eslint-disable-next-line no-await-in-loop
    await sleep(20);
  }
  throw new Error(`Timed out waiting for ${what}`);
};

const digits = (phone) => String(phone).replace(/\D/g, '');
const ids = (list) => list.map((record) => String(record._id || record.id || record));
const post = (body) => request(app).post('/v1/whatsapp/webhook').send(body).expect(httpStatus.OK);
const event = (field, value) => ({ entry: [{ changes: [{ field, value }] }] });

const WELCOME = {
  templateName: 'welcome_followup',
  language: 'en',
  defaultComponents: [{ type: 'body', parameters: [{ type: 'text', text: 'there' }] }],
};
const WELCOME_TEXT =
  'Hi there! Thanks for your interest in studying abroad with uLearn. When would be a good time for a quick call?';

describe('WhatsApp broadcasts and calls', () => {
  let seed;
  let u;
  let c;

  const as = (user) => {
    const token = `Bearer ${accessTokenFor(user)}`;
    return {
      get: (path) => request(app).get(path).set('Authorization', token),
      post: (path, body = {}) => request(app).post(path).set('Authorization', token).send(body),
    };
  };
  const withPhone = (students) => students.filter((s) => digits(s.phoneNo).length >= 8);
  const assignedTo = (user) => seed.students.filter((s) => s.assignedTo.some((a) => String(a.user) === String(user._id)));

  beforeEach(async () => {
    seed = await loadSeed();
    u = seed.users;
    c = seed.conversations;
  });

  describe('broadcasts', () => {
    const send = (user, audience, extra = {}) =>
      as(user).post('/v1/whatsapp/broadcasts', { ...WELCOME, audience, ...extra });
    const finished = (broadcast) =>
      until(async () => {
        const res = await as(u.admin).get(`/v1/whatsapp/broadcasts/${broadcast.id}`);
        return ['completed', 'failed'].includes(res.body.status) ? res.body : null;
      }, 'the broadcast to finish');
    const sentTo = async (user, students) => {
      const res = await send(user, { studentIds: ids(students) }).expect(httpStatus.CREATED);
      return finished(res.body);
    };

    describe('who it can go to', () => {
      test('a counsellor is offered their own students, all together and by stage', async () => {
        const mine = withPhone(assignedTo(u.counsellorA));
        const byStage = (stage) => mine.filter((s) => s.stage === stage).length;

        const res = await as(u.counsellorA).get('/v1/whatsapp/audience-segments').expect(httpStatus.OK);
        const segments = Object.fromEntries(res.body.results.map((s) => [s.key, s.estimatedRecipients]));

        expect(segments['my-students']).toBe(mine.length);
        expect(segments['all-students']).toBeUndefined();
        ['NotApplied', 'Applied', 'Enrolled', 'Lost'].forEach((stage) => {
          expect(segments[`stage-${stage.toLowerCase()}`] || 0).toBe(byStage(stage));
        });
      });

      test('an admin is offered every student as well', async () => {
        const res = await as(u.admin).get('/v1/whatsapp/audience-segments').expect(httpStatus.OK);
        const segments = Object.fromEntries(res.body.results.map((s) => [s.key, s]));

        expect(segments['all-students'].estimatedRecipients).toBe(withPhone(seed.students).length);
        expect(segments['all-students'].audience).toEqual({ filter: {} });
        expect(segments['my-students'].estimatedRecipients).toBe(0);
      });

      test("a counsellor cannot send to another counsellor's students, even by naming them", async () => {
        const theirs = assignedTo(u.counsellorB).slice(0, 2);

        const res = await send(u.counsellorA, { studentIds: ids(theirs) }).expect(httpStatus.BAD_REQUEST);

        expect(res.body.message).toMatch(/No students/);
        expect(await WhatsappBroadcast.countDocuments()).toBe(0);
        expect(await WhatsappMessage.countDocuments({ type: 'template' })).toBe(0);
      });

      test('of a list that mixes their own and others, only their own are sent to', async () => {
        const [mine] = assignedTo(u.counsellorA);
        const [theirs] = assignedTo(u.counsellorB);

        const res = await send(u.counsellorA, { studentIds: ids([mine, theirs]) }).expect(httpStatus.CREATED);
        const done = await finished(res.body);

        expect(done.recipients.map((r) => r.studentId)).toEqual(ids([mine]));
      });

      test('an admin can send to anybody', async () => {
        const [theirs] = assignedTo(u.counsellorB);

        const done = await sentTo(u.admin, [theirs]);

        expect(done.recipients.map((r) => r.studentId)).toEqual(ids([theirs]));
      });

      test('two students who share a number get one message, and a student with no usable number gets none', async () => {
        const [first] = assignedTo(u.counsellorA);
        const sibling = build.student({ phoneNo: first.phoneNo, assignedTo: first.assignedTo });
        const noNumber = build.student({ phoneNo: '12345', assignedTo: first.assignedTo });
        await Students.insertMany([sibling, noNumber], { timestamps: false });

        const done = await sentTo(u.counsellorA, [first, sibling, noNumber]);

        expect(done.recipientCount).toBe(1);
        expect(done.recipients.map((r) => r.phone)).toEqual([digits(first.phoneNo)]);
      });

      test('it needs a template, a language and an audience', async () => {
        const audience = { studentIds: ids(assignedTo(u.counsellorA).slice(0, 1)) };

        await as(u.counsellorA).post('/v1/whatsapp/broadcasts', { language: 'en', audience }).expect(httpStatus.BAD_REQUEST);
        await as(u.counsellorA)
          .post('/v1/whatsapp/broadcasts', { templateName: 'welcome_followup', audience })
          .expect(httpStatus.BAD_REQUEST);
        await as(u.counsellorA)
          .post('/v1/whatsapp/broadcasts', { templateName: 'welcome_followup', language: 'en' })
          .expect(httpStatus.BAD_REQUEST);
        await send(u.counsellorA, { studentIds: ['somebody'] }).expect(httpStatus.BAD_REQUEST);
      });
    });

    describe('sending one', () => {
      test('is answered at once as queued, then sent a recipient at a time', async () => {
        const two = assignedTo(u.counsellorA).slice(0, 2);

        const res = await send(u.counsellorA, { studentIds: ids(two) }, { audienceLabel: 'Two of mine' }).expect(
          httpStatus.CREATED
        );

        expect(res.body).toMatchObject({
          templateName: 'welcome_followup',
          language: 'en',
          status: 'queued',
          recipientCount: 2,
          counters: { queued: 2, sent: 0, delivered: 0, read: 0, failed: 0 },
          audienceLabel: 'Two of mine',
          createdBy: String(u.counsellorA._id),
        });
        const done = await finished(res.body);
        expect(done.status).toBe('completed');
        expect(done.counters).toEqual({ queued: 0, sent: 2, delivered: 0, read: 0, failed: 0 });
        expect(new Date(done.completedAt).getTime()).toBeGreaterThanOrEqual(new Date(done.startedAt).getTime());
      });

      test('each recipient gets the template in a conversation of their own, linked to them and given to their team', async () => {
        const [student] = assignedTo(u.counsellorA);

        const done = await sentTo(u.counsellorA, [student]);

        const [recipient] = done.recipients;
        expect(recipient).toMatchObject({ studentId: String(student._id), phone: digits(student.phoneNo), status: 'sent' });
        const conversation = await WhatsappConversation.findById(recipient.conversationId).lean();
        expect(String(conversation.student)).toBe(String(student._id));
        expect(conversation.assignees.map((a) => String(a.userId))).toEqual(student.assignedTo.map((a) => String(a.user)));
        expect(conversation.lastMessage).toMatchObject({ preview: WELCOME_TEXT, direction: 'outbound' });
        const messages = await WhatsappMessage.find({ conversation: conversation._id }).lean();
        expect(messages).toHaveLength(1);
        expect(messages[0]).toMatchObject({
          direction: 'outbound',
          type: 'template',
          text: WELCOME_TEXT,
          template: { name: 'welcome_followup', language: 'en' },
          status: 'sent',
        });
        expect(String(messages[0].broadcast)).toBe(done.id);
        expect(String(messages[0].sentByUser)).toBe(String(u.counsellorA._id));
      });

      test('a second one to the same student goes into the conversation there is', async () => {
        const [student] = assignedTo(u.counsellorA);

        const first = await sentTo(u.counsellorA, [student]);
        const second = await sentTo(u.counsellorA, [student]);

        expect(second.recipients[0].conversationId).toBe(first.recipients[0].conversationId);
        expect(await WhatsappMessage.countDocuments({ conversation: first.recipients[0].conversationId })).toBe(2);
      });
    });

    describe('news of the messages it sent', () => {
      let done;
      const receipt = async (index, status, errors) => {
        const { conversationId } = done.recipients[index];
        const message = await WhatsappMessage.findOne({ conversation: conversationId }).lean();
        await post(event('messages', { statuses: [{ id: message.waMessageId, status, ...(errors && { errors }) }] }));
      };
      const counters = () =>
        until(async () => {
          const res = await as(u.admin).get(`/v1/whatsapp/broadcasts/${done.id}`);
          return res.body;
        });
      const countersWhen = (moved) =>
        until(async () => {
          const res = await as(u.admin).get(`/v1/whatsapp/broadcasts/${done.id}`);
          return moved(res.body.counters) ? res.body : null;
        }, 'the counters to move');

      beforeEach(async () => {
        done = await sentTo(u.counsellorA, assignedTo(u.counsellorA).slice(0, 2));
      });

      test('moves its counters from sent to delivered to read', async () => {
        await receipt(0, 'delivered');
        expect((await countersWhen((n) => n.delivered === 1)).counters).toEqual({
          queued: 0,
          sent: 1,
          delivered: 1,
          read: 0,
          failed: 0,
        });

        await receipt(0, 'read');
        expect((await countersWhen((n) => n.read === 1)).counters).toMatchObject({ sent: 1, delivered: 0, read: 1 });
      });

      test('a failure is counted and kept against the recipient', async () => {
        await receipt(1, 'failed', [{ code: 131026, title: 'Message undeliverable' }]);

        const now = await countersWhen((n) => n.failed === 1);

        expect(now.counters).toMatchObject({ sent: 1, failed: 1 });
        expect(now.recipients[1]).toMatchObject({
          status: 'failed',
          error: { code: '131026', title: 'Message undeliverable' },
        });
        expect((await counters()).status).toBe('completed');
      });
    });

    describe('looking at them afterwards', () => {
      let mine;
      let theirs;

      beforeEach(async () => {
        mine = await sentTo(u.counsellorA, assignedTo(u.counsellorA).slice(0, 1));
        theirs = await sentTo(u.counsellorB, assignedTo(u.counsellorB).slice(0, 1));
      });

      test('a counsellor is listed their own, an admin everybody, newest first', async () => {
        const own = await as(u.counsellorA).get('/v1/whatsapp/broadcasts').expect(httpStatus.OK);
        const all = await as(u.admin).get('/v1/whatsapp/broadcasts').expect(httpStatus.OK);

        expect(own.body.results.map((b) => b.id)).toEqual([mine.id]);
        expect(all.body.results.map((b) => b.id)).toEqual([theirs.id, mine.id]);
        expect(all.body.results[0].recipients).toBeUndefined();
      });

      test("a counsellor cannot open another counsellor's, and an admin can", async () => {
        await as(u.counsellorA).get(`/v1/whatsapp/broadcasts/${theirs.id}`).expect(httpStatus.FORBIDDEN);
        await as(u.counsellorA).get(`/v1/whatsapp/broadcasts/${mine.id}`).expect(httpStatus.OK);
        await as(u.admin).get(`/v1/whatsapp/broadcasts/${theirs.id}`).expect(httpStatus.OK);
      });

      test('one that does not exist is 404, and an id that is not an id is refused', async () => {
        await as(u.admin).get(`/v1/whatsapp/broadcasts/${new mongoose.Types.ObjectId()}`).expect(httpStatus.NOT_FOUND);
        await as(u.admin).get('/v1/whatsapp/broadcasts/not-an-id').expect(httpStatus.BAD_REQUEST);
      });
    });
  });

  describe('calls', () => {
    const pathOf = (conversation) => `/v1/whatsapp/conversations/${conversation._id}`;
    const start = (conversation, body = { sdpOffer: 'v=0 a made-up offer' }) =>
      as(u.counsellorA).post(`${pathOf(conversation)}/calls`, body);
    const stored = (call) => WhatsappCall.findById(call.id || call._id).lean();
    const storedWhen = (call, changed) =>
      until(async () => {
        const now = await stored(call);
        return changed(now) ? now : null;
      }, 'the call to change');
    const seconds = (date) => String(Math.floor(date.getTime() / 1000));

    describe('permission to call', () => {
      test('is read from WhatsApp and remembered on the conversation', async () => {
        const res = await as(u.counsellorA)
          .get(`${pathOf(c[1])}/call-permission`)
          .expect(httpStatus.OK);

        expect(res.body).toEqual({ status: 'granted', callHoursOpen: true });
        expect((await WhatsappConversation.findById(c[1]._id).lean()).callPermission.status).toBe('permanent');
      });

      test('asking for it is recorded as pending', async () => {
        const res = await as(u.counsellorA)
          .post(`${pathOf(c[1])}/call-permission`)
          .expect(httpStatus.OK);

        expect(res.body).toMatchObject({ status: 'pending' });
        const { callPermission } = await WhatsappConversation.findById(c[1]._id).lean();
        expect(callPermission.status).toBe('pending');
        expect(callPermission.requestedAt).toBeInstanceOf(Date);
      });

      test.each([
        ['yes for good', { response: 'accept', is_permanent: true }, 'permanent', '✅ Allowed WhatsApp calls'],
        [
          'yes for now',
          { response: 'accept', expiration_timestamp: '1900000000' },
          'temporary',
          '✅ Allowed WhatsApp calls',
        ],
        ['no', { response: 'reject' }, 'none', '🚫 Declined WhatsApp calls'],
      ])('the contact answering %s is kept, and shown in the conversation', async (what, reply, status, line) => {
        const id = `test.wamid.permission.${status}`;
        await post(
          event('messages', {
            contacts: [{ profile: { name: c[1].contact.name }, wa_id: c[1].contact.waId }],
            messages: [
              {
                from: c[1].contact.waId,
                id,
                timestamp: seconds(new Date()),
                type: 'interactive',
                interactive: { type: 'call_permission_reply', call_permission_reply: reply },
              },
            ],
          })
        );

        const message = await until(() => WhatsappMessage.findOne({ waMessageId: id }).lean(), 'the reply to be stored');

        expect(message).toMatchObject({ type: 'system', text: line, direction: 'inbound' });
        expect((await WhatsappConversation.findById(c[1]._id).lean()).callPermission.status).toBe(status);
      });

      test('a conversation that does not exist is 404', async () => {
        await as(u.counsellorA)
          .get(`${pathOf({ _id: new mongoose.Types.ObjectId() })}/call-permission`)
          .expect(httpStatus.NOT_FOUND);
      });
    });

    describe('a call we make', () => {
      test('starts ringing, in the name of whoever made it', async () => {
        const res = await start(c[1]).expect(httpStatus.CREATED);

        expect(res.body).toMatchObject({
          conversationId: String(c[1]._id),
          contact: { phone: c[1].contact.phone },
          direction: 'business_initiated',
          status: 'ringing',
        });
        expect(res.body.waCallId).toEqual(expect.any(String));
        expect(String((await stored(res.body)).initiatedBy)).toBe(String(u.counsellorA._id));
      });

      test('needs the offer from the browser, and a conversation that exists', async () => {
        await start(c[1], {}).expect(httpStatus.BAD_REQUEST);
        await start({ _id: new mongoose.Types.ObjectId() }).expect(httpStatus.NOT_FOUND);

        expect(await WhatsappCall.countDocuments()).toBe(0);
      });

      test('is in progress once WhatsApp says it was answered, and ended with its length when it is over', async () => {
        const { body: call } = await start(c[1]);
        const answeredAt = new Date(Date.now() - 60 * 1000);

        await post(
          event('calls', {
            statuses: [{ id: call.waCallId, type: 'call', status: 'ACCEPTED', timestamp: seconds(answeredAt) }],
          })
        );
        const answered = await storedWhen(call, (now) => now.status === 'in_call');
        expect(seconds(answered.connectedAt)).toBe(seconds(answeredAt));

        await post(
          event('calls', { calls: [{ id: call.waCallId, event: 'terminate', status: 'COMPLETED', duration: 42 }] })
        );
        const over = await storedWhen(call, (now) => now.status === 'ended');
        expect(over).toMatchObject({ endReason: 'completed', durationSec: 42 });
      });

      test('that the contact turns down is recorded as rejected', async () => {
        const { body: call } = await start(c[1]);

        await post(event('calls', { statuses: [{ id: call.waCallId, type: 'call', status: 'REJECTED' }] }));

        expect(await storedWhen(call, (now) => now.status === 'rejected')).toMatchObject({ endReason: 'rejected' });
      });

      test('that nobody picks up is recorded as missed', async () => {
        const { body: call } = await start(c[1]);

        await post(event('calls', { calls: [{ id: call.waCallId, event: 'terminate', status: 'COMPLETED' }] }));

        expect(await storedWhen(call, (now) => now.status === 'missed')).toMatchObject({ endReason: 'no_answer' });
      });

      test('that fails is recorded with the reason WhatsApp gives', async () => {
        const { body: call } = await start(c[1]);

        await post(
          event('calls', {
            calls: [
              {
                id: call.waCallId,
                event: 'terminate',
                status: 'FAILED',
                errors: [{ code: 138006, message: 'No permission' }],
              },
            ],
          })
        );

        const failed = await storedWhen(call, (now) => now.status === 'failed');
        expect(failed).toMatchObject({ endReason: 'failed', error: { code: '138006', title: 'No permission' } });
      });

      test('hung up before it is answered is missed, and after it is answered is ended', async () => {
        const { body: unanswered } = await start(c[1]);
        const first = await as(u.counsellorA).post(`/v1/whatsapp/calls/${unanswered.id}/terminate`).expect(httpStatus.OK);
        expect(first.body).toEqual({ durationSec: 0 });
        expect(await stored(unanswered)).toMatchObject({ status: 'missed', endReason: 'no_answer' });

        const { body: answered } = await start(c[1]);
        await WhatsappCall.updateOne(
          { _id: answered.id },
          { status: 'in_call', connectedAt: new Date(Date.now() - 30 * 1000) }
        );
        const second = await as(u.counsellorA).post(`/v1/whatsapp/calls/${answered.id}/terminate`).expect(httpStatus.OK);
        expect(second.body.durationSec).toBeGreaterThanOrEqual(30);
        expect(second.body.durationSec).toBeLessThan(35);
        expect(await stored(answered)).toMatchObject({ status: 'ended', endReason: 'completed' });
      });

      test('hanging up a call that is already over changes nothing', async () => {
        const { body: call } = await start(c[1]);
        await as(u.counsellorA).post(`/v1/whatsapp/calls/${call.id}/terminate`).expect(httpStatus.OK);
        const before = await stored(call);

        await as(u.counsellorA).post(`/v1/whatsapp/calls/${call.id}/terminate`).expect(httpStatus.OK);

        expect((await stored(call)).endedAt).toEqual(before.endedAt);
      });
    });

    describe('a call a contact makes', () => {
      const rings = async (from = c[1].contact.waId, id = 'wacid.test.inbound') => {
        await post(
          event('calls', {
            calls: [
              {
                id,
                from,
                direction: 'USER_INITIATED',
                event: 'connect',
                timestamp: seconds(new Date()),
                session: { sdp_type: 'offer', sdp: 'v=0 the caller offer' },
              },
            ],
          })
        );
        return id;
      };
      const ringing = (id) =>
        until(() => WhatsappCall.findOne({ waCallId: id, sdpOffer: { $exists: true } }).lean(), 'the call');

      test('from a number we talk to is recorded as ringing, with what is needed to answer it', async () => {
        const call = await ringing(await rings());

        expect(call).toMatchObject({ direction: 'user_initiated', status: 'ringing', sdpOffer: 'v=0 the caller offer' });
        expect(String(call.conversation)).toBe(String(c[1]._id));
      });

      test('from a number we have never talked to is not recorded', async () => {
        await rings('96509900099', 'wacid.test.stranger');
        await ringing(await rings());

        expect(await WhatsappCall.countDocuments()).toBe(1);
        expect(await WhatsappCall.findOne({ waCallId: 'wacid.test.stranger' })).toBeNull();
      });

      test('can be answered from the browser, once', async () => {
        const call = await ringing(await rings());

        const res = await as(u.counsellorA)
          .post(`/v1/whatsapp/calls/${call._id}/accept`, { sdpAnswer: 'v=0 our answer' })
          .expect(httpStatus.OK);

        expect(res.body).toMatchObject({ status: 'in_call', direction: 'user_initiated' });
        const now = await stored(call);
        expect(now.connectedAt).toBeInstanceOf(Date);
        expect(now.sdpOffer).toBeUndefined();
        await as(u.counsellorB)
          .post(`/v1/whatsapp/calls/${call._id}/accept`, { sdpAnswer: 'v=0 a second answer' })
          .expect(httpStatus.CONFLICT);
      });

      test('can be turned down', async () => {
        const call = await ringing(await rings());

        const res = await as(u.counsellorA).post(`/v1/whatsapp/calls/${call._id}/reject`).expect(httpStatus.OK);

        expect(res.body.status).toBe('rejected');
        expect(await stored(call)).toMatchObject({ status: 'rejected', endReason: 'rejected' });
      });

      test('answering needs an answer from the browser, and only works on a call that came in', async () => {
        const call = await ringing(await rings());
        const { body: ours } = await start(c[1]);

        await as(u.counsellorA).post(`/v1/whatsapp/calls/${call._id}/accept`, {}).expect(httpStatus.BAD_REQUEST);
        await as(u.counsellorA)
          .post(`/v1/whatsapp/calls/${ours.id}/accept`, { sdpAnswer: 'v=0 our answer' })
          .expect(httpStatus.BAD_REQUEST);
        await as(u.counsellorA)
          .post(`/v1/whatsapp/calls/${new mongoose.Types.ObjectId()}/accept`, { sdpAnswer: 'v=0 our answer' })
          .expect(httpStatus.NOT_FOUND);
      });
    });

    test('the calls of a conversation are listed newest first', async () => {
      const { body: first } = await start(c[1]);
      await WhatsappCall.updateOne({ _id: first.id }, { startedAt: new Date(Date.now() - 60 * 1000) });
      const { body: second } = await start(c[1]);
      await start(c[3]);

      const res = await as(u.counsellorA)
        .get(`${pathOf(c[1])}/calls`)
        .expect(httpStatus.OK);

      expect(res.body.results.map((call) => call.id)).toEqual([second.id, first.id]);
    });

    test('calling is for staff: partners and callers with no token are refused', async () => {
      await request(app)
        .post(`${pathOf(c[1])}/calls`)
        .send({ sdpOffer: 'v=0' })
        .expect(httpStatus.UNAUTHORIZED);
      await as(u.subAgentA)
        .post(`${pathOf(c[1])}/calls`, { sdpOffer: 'v=0' })
        .expect(httpStatus.FORBIDDEN);
      await as(u.schoolA).get('/v1/whatsapp/broadcasts').expect(httpStatus.FORBIDDEN);
      await as(u.subAgentA).post('/v1/whatsapp/broadcasts', WELCOME).expect(httpStatus.FORBIDDEN);
    });
  });

  // How things are today, written down so a change shows up. None of these lets
  // anybody see or change what they should not. When one is changed, its test
  // fails and is rewritten to say what is then true.
  describe('not as one would expect yet', () => {
    test('a broadcast by nationality reaches nobody, because the nationality is kept as more than its name', async () => {
      const kuwaiti = build.student({ nationality: { english_name: 'Kuwait', alpha2_code: 'KW' } });
      await Students.insertMany([kuwaiti], { timestamps: false });

      const res = await as(u.admin)
        .post('/v1/whatsapp/broadcasts', { ...WELCOME, audience: { filter: { nationality: 'Kuwait' } } })
        .expect(httpStatus.BAD_REQUEST);

      expect(res.body.message).toMatch(/No students/);
    });

    test('a broadcast goes to a referral that was turned down, and to one nobody has reviewed yet', async () => {
      const turnedDown = seed.students.find((s) => s.stage === 'Denied');
      const notReviewed = seed.students.find((s) => s.stage === 'PendingReview');

      const res = await as(u.admin)
        .post('/v1/whatsapp/broadcasts', { ...WELCOME, audience: { studentIds: ids([turnedDown, notReviewed]) } })
        .expect(httpStatus.CREATED);

      expect(res.body.recipientCount).toBe(2);
      await until(
        async () => (await WhatsappBroadcast.findById(res.body.id).lean()).status === 'completed',
        'the broadcast'
      );
    });
  });

  test('none of this tried to reach anything outside the machine', () => {
    expect(blocked).toEqual([]);
  });
});
