const request = require('supertest');
const httpStatus = require('http-status');
const app = require('../../src/app');
const setupTestDB = require('../utils/setupTestDB');
const { WhatsappConversation, WhatsappMessage, Students } = require('../../src/models');
const { loadSeed } = require('../seed/loadSeed');
const { build } = require('../factories');
const { accessTokenFor } = require('../fixtures/token.fixture');
const { blocked } = require('../utils/blockNetwork');

setupTestDB();

/**
 * The two WhatsApp analytics pages, and sending a voice note.
 *
 * The pages answer for "today", the last 7 days or the last 30, and every day
 * is a day in Kuwait. So each test says what the time is: 12:00 in Kuwait on
 * 10 March 2026, which is 09:00 UTC. Only the date is set; timers run as
 * usual.
 *
 * The seed's own conversations are cleared before every test, so every figure
 * is what the test put there and each expectation can be the whole of it.
 */

const ALL_BUT_THE_DATE = [
  'hrtime',
  'nextTick',
  'performance',
  'queueMicrotask',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'requestIdleCallback',
  'cancelIdleCallback',
  'setImmediate',
  'clearImmediate',
  'setInterval',
  'clearInterval',
  'setTimeout',
  'clearTimeout',
];

const NOW = '2026-03-10T09:00:00.000Z';
const at = (iso) => new Date(iso);
// A time today, as the clock in Kuwait reads it: today('08:30') is 05:30 UTC.
const today = (kuwaitTime) => at(`2026-03-10T${kuwaitTime}:00.000+03:00`);
const idOf = (record) => String(record._id || record.id || record);
const insert = (Model, records) => Model.insertMany(records, { timestamps: false });

describe('WhatsApp analytics and voice notes', () => {
  let seed;
  let u;
  const as = (user) => ({
    get: (path) =>
      request(app)
        .get(path)
        .set('Authorization', `Bearer ${accessTokenFor(user)}`),
  });
  const overview = async (range) => {
    const res = await as(u.admin)
      .get(`/v1/whatsapp/analytics/overview${range ? `?range=${range}` : ''}`)
      .expect(httpStatus.OK);
    return res.body;
  };
  const team = async (range) => {
    const res = await as(u.admin)
      .get(`/v1/whatsapp/analytics/team${range ? `?range=${range}` : ''}`)
      .expect(httpStatus.OK);
    return res.body;
  };
  const owner = (user, role = 'sales') => ({ userId: user._id, role });
  // A conversation begun long ago, so that it is not "new" unless a test says so.
  const chat = (overrides = {}) => {
    const begun = at('2025-12-01T09:00:00.000Z');
    return build.conversation({ createdAt: begun, updatedAt: begun, lastMessageAt: begun, ...overrides });
  };
  const said = (conversation, direction, when, overrides = {}) =>
    build.message({
      conversation: conversation._id,
      direction,
      timestamp: when,
      createdAt: when,
      updatedAt: when,
      ...overrides,
    });
  const from = (conversation, when, overrides) => said(conversation, 'inbound', when, overrides);
  const to = (conversation, when, by, overrides) =>
    said(conversation, 'outbound', when, { sentByUser: by._id, ...overrides });

  beforeEach(async () => {
    seed = await loadSeed();
    u = seed.users;
    await WhatsappConversation.deleteMany({});
    await WhatsappMessage.deleteMany({});
    jest.useFakeTimers({ now: at(NOW), doNotFake: ALL_BUT_THE_DATE });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('the overview page', () => {
    test('with nothing in the inbox, every figure is nought and the charts are still drawn', async () => {
      const answer = await overview();

      expect(answer.range).toBe('today');
      expect(answer.kpis).toEqual({
        messagesTotal: 0,
        messagesSent: 0,
        messagesReceived: 0,
        voiceSent: 0,
        voiceReceived: 0,
        unread: 0,
        conversationsHandled: 0,
        newConversations: 0,
        waitingForReply: 0,
        avgResponseSec: 0,
        lateReplies: 0,
        repeatedQuestions: 0,
        repeatedMessages: 0,
        openConversations: 0,
        unlinked: 0,
        followUpsOverdue: 0,
        resolved: 0,
        docsFiled: 0,
        templatesSent: 0,
      });
      expect(answer.waiting).toEqual([]);
      expect(answer.messagesByHour).toHaveLength(24);
      expect(answer.messagesPerDay).toHaveLength(14);
      expect(answer.newConversationsTrend).toHaveLength(14);
      expect(answer.funnel.map((row) => row.count)).toEqual([0, 0, 0, 0, 0, 0]);
    });

    test('counts what was sent and received today, voice notes among them, and leaves notes to the team out', async () => {
      const c = chat();
      await insert(WhatsappConversation, [c]);
      await insert(WhatsappMessage, [
        from(c, today('08:00')),
        from(c, today('08:05'), { type: 'audio', text: undefined }),
        to(c, today('08:10'), u.counsellorA),
        to(c, today('08:20'), u.counsellorA, { type: 'audio', text: undefined }),
        from(c, today('08:30')),
        // a note for the team: an outbound row that never reached the student
        to(c, today('08:40'), u.counsellorA, { internal: true }),
      ]);

      const { kpis } = await overview();

      expect(kpis).toMatchObject({
        messagesTotal: 5,
        messagesSent: 2,
        messagesReceived: 3,
        voiceSent: 1,
        voiceReceived: 1,
        conversationsHandled: 1,
      });
    });

    test('today begins at midnight in Kuwait, which is 21:00 the evening before in UTC', async () => {
      const c = chat();
      await insert(WhatsappConversation, [c]);
      await insert(WhatsappMessage, [
        from(c, at('2026-03-09T20:59:00.000Z')),
        from(c, at('2026-03-09T21:00:00.000Z')),
        from(c, at('2026-03-09T21:30:00.000Z')),
      ]);

      const answer = await overview('today');

      expect(answer.window).toEqual({ start: '2026-03-09T21:00:00.000Z', end: NOW, timezone: 'Asia/Kuwait' });
      expect(answer.kpis.messagesReceived).toBe(2);
    });

    test('7 and 30 days reach back that many days in Kuwait, today included', async () => {
      const c = chat();
      await insert(WhatsappConversation, [c]);
      await insert(WhatsappMessage, [
        // six days back, just after midnight in Kuwait; and a minute before it
        from(c, at('2026-03-03T21:01:00.000Z')),
        from(c, at('2026-03-03T20:59:00.000Z')),
        // twenty-nine days back; and a minute before that day began
        from(c, at('2026-02-08T21:01:00.000Z')),
        from(c, at('2026-02-08T20:59:00.000Z')),
      ]);

      const week = await overview('7d');
      const month = await overview('30d');

      expect(week.window.start).toBe('2026-03-03T21:00:00.000Z');
      expect(week.kpis.messagesReceived).toBe(1);
      expect(month.window.start).toBe('2026-02-08T21:00:00.000Z');
      expect(month.kpis.messagesReceived).toBe(3);
    });

    test('a range that is not one of the three is refused', async () => {
      await as(u.admin).get('/v1/whatsapp/analytics/overview?range=yesterday').expect(httpStatus.BAD_REQUEST);
      await as(u.admin).get('/v1/whatsapp/analytics/team?range=1y').expect(httpStatus.BAD_REQUEST);
    });

    test('the time to reply runs from the first message left unanswered to the first reply, and over 15 minutes is late', async () => {
      const quick = chat();
      const slow = chat();
      const noted = chat();
      await insert(WhatsappConversation, [quick, slow, noted]);
      await insert(WhatsappMessage, [
        // 10 minutes, counted from the first of the two
        from(quick, today('06:00')),
        from(quick, today('06:05')),
        to(quick, today('06:10'), u.counsellorA),
        // 20 minutes
        from(slow, today('07:00')),
        to(slow, today('07:20'), u.counsellorA),
        // 30 minutes: a note to the team in between is not a reply
        from(noted, today('08:00')),
        to(noted, today('08:01'), u.counsellorB, { internal: true }),
        to(noted, today('08:30'), u.counsellorB),
      ]);

      const { kpis } = await overview();

      expect(kpis.avgResponseSec).toBe(20 * 60);
      expect(kpis.lateReplies).toBe(2);
      expect(kpis.conversationsHandled).toBe(3);
    });

    test('the students waiting are the open chats whose last message is theirs, longest wait first', async () => {
      const linked = seed.students.find((s) => s.stage === 'Applied');
      const sinceSix = chat({
        contact: { phone: '+96550000001', name: 'Waiting Since Six', waId: '96550000001' },
        assignees: [owner(u.counsellorA), owner(u.counsellorB, 'accountManager')],
        student: linked._id,
      });
      const sinceFour = chat({ contact: { phone: '+96550000002', name: 'Waiting Since Four', waId: '96550000002' } });
      const answered = chat({ lastMessage: { preview: 'Done', at: today('08:00'), direction: 'outbound' } });
      const closed = chat({ status: 'resolved' });
      await insert(WhatsappConversation, [sinceSix, sinceFour, answered, closed]);
      await insert(WhatsappMessage, [
        to(sinceSix, today('05:00'), u.counsellorA),
        // waiting since the first of these, not the latest
        from(sinceSix, today('06:00')),
        from(sinceSix, today('08:00')),
        from(sinceFour, today('04:00')),
        from(answered, today('07:00')),
        to(answered, today('08:00'), u.counsellorA),
        from(closed, today('03:00')),
      ]);

      const answer = await overview();

      expect(answer.kpis.waitingForReply).toBe(2);
      expect(answer.waiting).toEqual([
        {
          conversationId: idOf(sinceFour),
          name: 'Waiting Since Four',
          assignee: null,
          unlinked: true,
          waitingSec: 8 * 60 * 60,
          unanswered: 1,
        },
        {
          conversationId: idOf(sinceSix),
          name: 'Waiting Since Six',
          stage: 'Applied',
          assignee: idOf(u.counsellorA),
          unlinked: false,
          waitingSec: 6 * 60 * 60,
          unanswered: 2,
        },
      ]);
    });

    test('the list of those waiting stops at eight; the count does not', async () => {
      const chats = Array.from({ length: 10 }, () => chat());
      await insert(WhatsappConversation, chats);
      await insert(
        WhatsappMessage,
        chats.map((c, index) => from(c, today(`0${index}:30`)))
      );

      const answer = await overview();

      expect(answer.kpis.waitingForReply).toBe(10);
      expect(answer.waiting).toHaveLength(8);
      expect(answer.waiting[0].conversationId).toBe(idOf(chats[0]));
    });

    test('the state of the inbox is counted as it is now, and what was resolved or begun is counted for the range', async () => {
      const linked = seed.students[0];
      const overdue = at('2026-03-09T09:00:00.000Z');
      const later = at('2026-03-11T09:00:00.000Z');
      const lastWeek = at('2026-03-02T09:00:00.000Z');
      await insert(WhatsappConversation, [
        chat({ unreadCount: 2, student: linked._id, nextFollowUpAt: overdue }),
        chat({ unreadCount: 3, nextFollowUpAt: later }),
        chat({ status: 'waiting', createdAt: today('09:00') }),
        // resolved today: none of the "now" figures count it
        chat({ status: 'resolved', resolvedAt: today('10:00'), unreadCount: 7, nextFollowUpAt: overdue }),
        // resolved before the moment was recorded: its last change is used
        chat({ status: 'resolved', updatedAt: today('11:00') }),
        chat({ status: 'resolved', resolvedAt: lastWeek, updatedAt: today('11:00') }),
      ]);

      const { kpis } = await overview();

      expect(kpis).toMatchObject({
        openConversations: 3,
        unlinked: 2,
        followUpsOverdue: 1,
        unread: 5,
        resolved: 2,
        newConversations: 1,
      });
    });

    test('files put on a student record and templates sent are counted for the range', async () => {
      const c = chat();
      const yesterday = at('2026-03-09T09:00:00.000Z');
      await insert(WhatsappConversation, [c]);
      await insert(WhatsappMessage, [
        from(c, today('08:00'), { type: 'document', savedDocument: { id: seed.documents[0]._id, label: 'Passport' } }),
        from(c, today('08:05'), { type: 'document' }),
        from(c, yesterday, { type: 'document', savedDocument: { id: seed.documents[1]._id, label: 'Transcript' } }),
        to(c, today('08:10'), u.counsellorA, { type: 'template' }),
        to(c, today('08:15'), u.counsellorA, { type: 'template' }),
        to(c, yesterday, u.counsellorA, { type: 'template' }),
      ]);

      const { kpis } = await overview();

      expect(kpis.docsFiled).toBe(1);
      expect(kpis.templatesSent).toBe(2);
    });

    test('a question is repeated when the same words come in more than once, whatever their capitals or spaces', async () => {
      const first = chat();
      const second = chat();
      await insert(WhatsappConversation, [first, second]);
      await insert(WhatsappMessage, [
        from(first, today('08:00'), { text: 'How much is it?' }),
        from(second, today('08:01'), { text: '  how much is it?  ' }),
        from(second, today('08:02'), { text: 'HOW MUCH IS IT?' }),
        from(first, today('08:03'), { text: 'When does it start?' }),
        from(second, today('08:04'), { text: 'When does it start?' }),
        from(first, today('08:05'), { text: 'Asked only once' }),
        // what we send is not a question from a student
        to(first, today('08:06'), u.counsellorA, { text: 'How much is it?' }),
      ]);

      const { kpis } = await overview();

      expect(kpis.repeatedQuestions).toBe(2);
      expect(kpis.repeatedMessages).toBe(5);
    });

    test('messages by hour go by the clock in Kuwait', async () => {
      const c = chat();
      await insert(WhatsappConversation, [c]);
      await insert(WhatsappMessage, [
        from(c, today('00:30')),
        from(c, today('08:10')),
        from(c, today('08:50')),
        to(c, today('08:55'), u.counsellorA),
        to(c, today('11:59'), u.counsellorA),
      ]);

      const { messagesByHour } = await overview();

      expect(messagesByHour.map((row) => row.hour)).toEqual(Array.from({ length: 24 }, (_, hour) => hour));
      expect(messagesByHour.filter((row) => row.sent || row.received)).toEqual([
        { hour: 0, sent: 0, received: 1 },
        { hour: 8, sent: 1, received: 2 },
        { hour: 11, sent: 1, received: 0 },
      ]);
    });

    test('the two 14-day charts are the last 14 days in Kuwait, oldest first, whatever range is asked for', async () => {
      const c = chat({ createdAt: at('2026-03-09T21:30:00.000Z') });
      const earlier = chat({ createdAt: at('2026-02-24T21:30:00.000Z') });
      const tooOld = chat({ createdAt: at('2026-02-24T20:30:00.000Z') });
      await insert(WhatsappConversation, [c, earlier, tooOld]);
      await insert(WhatsappMessage, [
        // half past midnight on the 10th in Kuwait
        from(c, at('2026-03-09T21:30:00.000Z')),
        // half past eleven at night on the 9th in Kuwait
        to(c, at('2026-03-09T20:30:00.000Z'), u.counsellorA),
        from(c, at('2026-02-24T21:30:00.000Z')),
      ]);

      const answer = await overview('today');

      const dates = answer.messagesPerDay.map((row) => row.date);
      expect(dates).toHaveLength(14);
      expect(dates[0]).toBe('2026-02-25');
      expect(dates[13]).toBe('2026-03-10');
      expect(answer.newConversationsTrend.map((row) => row.date)).toEqual(dates);
      expect(answer.messagesPerDay.filter((row) => row.sent || row.received)).toEqual([
        { date: '2026-02-25', sent: 0, received: 1 },
        { date: '2026-03-09', sent: 1, received: 0 },
        { date: '2026-03-10', sent: 0, received: 1 },
      ]);
      expect(answer.newConversationsTrend.filter((row) => row.count)).toEqual([
        { date: '2026-02-25', count: 1 },
        { date: '2026-03-10', count: 1 },
      ]);
    });

    test('the funnel is the students we talk to on WhatsApp by stage, each once however many chats they have', async () => {
      const applied = seed.students.find((s) => s.stage === 'Applied');
      const enrolled = seed.students.find((s) => s.stage === 'Enrolled');
      const lost = build.student({ stage: 'Lost' });
      await insert(Students, [lost]);
      await insert(WhatsappConversation, [
        chat({ student: applied._id }),
        chat({ student: applied._id }),
        chat({ student: enrolled._id, status: 'resolved' }),
        chat({ student: lost._id }),
        chat(),
      ]);

      const { funnel } = await overview();

      expect(funnel).toEqual([
        { key: 'NotApplied', label: 'New / Not applied', count: 0 },
        { key: 'PendingReview', label: 'Pending review', count: 0 },
        { key: 'Applied', label: 'Applied', count: 1 },
        { key: 'Enrolled', label: 'Enrolled', count: 1 },
        { key: 'Lost', label: 'Lost', count: 1 },
        { key: 'Denied', label: 'Denied', count: 0 },
      ]);
    });
  });

  describe('the team page', () => {
    const rowOf = (answer, user) => answer.counselors.find((row) => row.userId === idOf(user));

    test('answers for the last 7 days unless told otherwise', async () => {
      const answer = await team();

      expect(answer.range).toBe('7d');
      expect(answer.window).toEqual({ start: '2026-03-03T21:00:00.000Z', end: NOW, timezone: 'Asia/Kuwait' });
      expect(answer.counselors).toEqual([]);
      expect(answer.totals).toEqual({ messagesSent: 0, conversationsHandled: 0, lateReplies: 0, avgResponseSec: 0 });
    });

    test("each person's row is what they sent, voice notes among it, and the chats they wrote in; most chats first", async () => {
      const first = chat();
      const second = chat();
      await insert(WhatsappConversation, [first, second]);
      await insert(WhatsappMessage, [
        to(first, today('08:00'), u.counsellorA),
        to(second, today('08:01'), u.counsellorA, { type: 'audio', text: undefined }),
        to(first, today('08:02'), u.counsellorB),
        to(first, today('08:03'), u.counsellorB),
        to(first, today('08:04'), u.counsellorB),
        // a note to the team is not something sent
        to(second, today('08:05'), u.counsellorB, { internal: true }),
        // eight days ago: outside the 7 days
        to(second, at('2026-03-02T09:00:00.000Z'), u.counsellorB),
      ]);

      const answer = await team();

      expect(
        answer.counselors.map((row) => [row.rank, row.name, row.messagesSent, row.voiceSent, row.conversationsHandled])
      ).toEqual([
        [1, u.counsellorA.name, 2, 1, 2],
        [2, u.counsellorB.name, 3, 0, 1],
      ]);
      expect(rowOf(answer, u.counsellorA).initials).toBe(
        u.counsellorA.name
          .split(' ')
          .map((part) => part[0])
          .join('')
      );
      expect(answer.totals).toMatchObject({ messagesSent: 5, conversationsHandled: 3 });
    });

    test('somebody who sent nothing still has a row when chats are theirs: pending, open, overdue and unlinked', async () => {
      const linked = seed.students[0];
      const overdue = at('2026-03-09T09:00:00.000Z');
      const waiting = chat({ assignees: [owner(u.counsellorB)], student: linked._id });
      // both of the person's roles on one chat: it is counted once
      const twice = chat({
        assignees: [owner(u.counsellorB), owner(u.counsellorB, 'accountManager')],
        lastMessage: { preview: 'Done', at: today('08:00'), direction: 'outbound' },
        nextFollowUpAt: overdue,
      });
      const closed = chat({ assignees: [owner(u.counsellorB)], status: 'resolved', nextFollowUpAt: overdue });
      await insert(WhatsappConversation, [waiting, twice, closed]);
      await insert(WhatsappMessage, [from(waiting, today('07:00'))]);

      const answer = await team();

      expect(answer.counselors).toHaveLength(1);
      expect(rowOf(answer, u.counsellorB)).toMatchObject({
        name: u.counsellorB.name,
        messagesSent: 0,
        conversationsHandled: 0,
        pending: 1,
        openConversations: 2,
        followUpsOverdue: 1,
        unlinked: 1,
      });
    });

    test("a reply's time is put to the person who sent it", async () => {
      const first = chat();
      const second = chat();
      await insert(WhatsappConversation, [first, second]);
      await insert(WhatsappMessage, [
        from(first, today('06:00')),
        to(first, today('06:10'), u.counsellorA),
        from(first, today('07:00')),
        to(first, today('07:30'), u.counsellorA),
        from(second, today('08:00')),
        to(second, today('08:05'), u.counsellorB),
      ]);

      const answer = await team();

      expect(rowOf(answer, u.counsellorA)).toMatchObject({ avgResponseSec: 20 * 60, lateReplies: 1 });
      expect(rowOf(answer, u.counsellorB)).toMatchObject({ avgResponseSec: 5 * 60, lateReplies: 0 });
      expect(answer.totals).toMatchObject({ avgResponseSec: 15 * 60, lateReplies: 1 });
    });

    test("each row has the person's replies for each of the last 14 days in Kuwait", async () => {
      const c = chat();
      await insert(WhatsappConversation, [c]);
      await insert(WhatsappMessage, [
        to(c, today('08:00'), u.counsellorA),
        to(c, today('08:01'), u.counsellorA),
        // half past eleven at night on the 9th in Kuwait
        to(c, at('2026-03-09T20:30:00.000Z'), u.counsellorA),
      ]);

      const { perDay } = rowOf(await team(), u.counsellorA);

      expect(perDay).toHaveLength(14);
      expect(perDay[0].date).toBe('2026-02-25');
      expect(perDay.slice(-2)).toEqual([
        { date: '2026-03-09', sent: 1 },
        { date: '2026-03-10', sent: 2 },
      ]);
    });

    test("any member of staff is shown everybody's figures; a partner is shown none", async () => {
      const c = chat();
      await insert(WhatsappConversation, [c]);
      await insert(WhatsappMessage, [to(c, today('08:00'), u.counsellorB)]);

      const seen = await as(u.counsellorA).get('/v1/whatsapp/analytics/team').expect(httpStatus.OK);
      await as(u.counsellorA).get('/v1/whatsapp/analytics/overview').expect(httpStatus.OK);

      expect(seen.body.counselors.map((row) => row.userId)).toEqual([idOf(u.counsellorB)]);
      await as(u.subAgentA).get('/v1/whatsapp/analytics/team').expect(httpStatus.FORBIDDEN);
      await as(u.schoolA).get('/v1/whatsapp/analytics/overview').expect(httpStatus.FORBIDDEN);
    });
  });

  describe('sending a voice note', () => {
    const anHourFromNow = () => new Date(Date.now() + 60 * 60 * 1000);
    const voice = (conversation, user = u.counsellorA) =>
      request(app)
        .post(`/v1/whatsapp/conversations/${idOf(conversation)}/messages/voice`)
        .set('Authorization', `Bearer ${accessTokenFor(user)}`);
    // Already in the format WhatsApp plays, so nothing has to be converted.
    const recording = { filename: 'voice.m4a', contentType: 'audio/mp4' };

    test('within a day of the contact writing, it goes out and is recorded as an audio message from the caller', async () => {
      const c = chat({ windowExpiresAt: anHourFromNow(), assignees: [owner(u.counsellorA)] });
      await insert(WhatsappConversation, [c]);

      const res = await voice(c)
        .field('clientRef', 'voice-ref-1')
        .field('durationSec', '7')
        .attach('file', Buffer.from('not really a recording'), recording)
        .expect(httpStatus.CREATED);

      const stored = await WhatsappMessage.find({ conversation: c._id }).lean();
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({
        direction: 'outbound',
        type: 'audio',
        status: 'sent',
        clientRef: 'voice-ref-1',
        durationSec: 7,
        internal: false,
      });
      expect(String(stored[0].sentByUser)).toBe(idOf(u.counsellorA));
      expect(stored[0].media).toMatchObject({ type: 'audio', mimeType: 'audio/mp4' });
      expect(stored[0].media.url).toEqual(expect.any(String));
      expect(res.body).toMatchObject({ direction: 'outbound', type: 'audio' });
      // and the conversation's last message is the voice note
      const now = await WhatsappConversation.findById(c._id).lean();
      expect(now.lastMessage).toMatchObject({ preview: '🎤 Voice note', direction: 'outbound' });
      // which the analytics count as a voice note sent
      expect((await overview()).kpis).toMatchObject({ messagesSent: 1, voiceSent: 1 });
    });

    test('more than a day after they last wrote, it is refused and nothing is stored', async () => {
      const c = chat({ windowExpiresAt: at('2026-03-09T09:00:00.000Z') });
      const never = chat();
      await insert(WhatsappConversation, [c, never]);

      const closed = await voice(c).attach('file', Buffer.from('not really a recording'), recording);
      const neverOpened = await voice(never).attach('file', Buffer.from('not really a recording'), recording);

      expect(closed.status).toBe(httpStatus.CONFLICT);
      expect(closed.body).toEqual({ code: 'WINDOW_CLOSED' });
      expect(neverOpened.status).toBe(httpStatus.CONFLICT);
      expect(await WhatsappMessage.countDocuments()).toBe(0);
    });

    test('for a conversation that does not exist, or an id that is not one, it is refused', async () => {
      await voice('5eed000a0000000000ffffff')
        .attach('file', Buffer.from('not really a recording'), recording)
        .expect(httpStatus.NOT_FOUND);
      await voice('not-an-id')
        .attach('file', Buffer.from('not really a recording'), recording)
        .expect(httpStatus.BAD_REQUEST);
    });

    test('a partner cannot send one', async () => {
      const c = chat({ windowExpiresAt: anHourFromNow() });
      await insert(WhatsappConversation, [c]);

      await voice(c, u.subAgentA)
        .attach('file', Buffer.from('not really a recording'), recording)
        .expect(httpStatus.FORBIDDEN);

      expect(await WhatsappMessage.countDocuments()).toBe(0);
    });
  });

  test('none of this tried to reach anything outside the machine', () => {
    expect(blocked).toEqual([]);
  });
});
