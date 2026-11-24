/**
 * The WhatsApp dashboards count in KUWAIT days, whatever clock the server
 * runs on: "today" starts at 00:00 Kuwait time and the 14-day charts are
 * labelled with Kuwait dates. The recount used by scripts/check-whatsapp-analytics.js
 * works the days out its own way (Intl); the two must agree.
 */
jest.mock('../../../src/models', () => ({}));

const {
  rangeToWindow,
  kuwaitDayKey,
  kuwaitDayStart,
  lastKuwaitDays,
} = require('../../../src/services/whatsappAnalytics.services');
const { windowOf, kuwaitDay, recount } = require('../../../scripts/lib/whatsappRecount');

const at = (iso) => new Date(iso);

describe('Kuwait days', () => {
  test('"today" starts at midnight in Kuwait (21:00 UTC the evening before)', () => {
    // 00:00:30 in Kuwait on the 23rd
    expect(rangeToWindow('today', at('2026-11-22T21:00:30Z')).start.toISOString()).toBe('2026-11-22T21:00:00.000Z');
    // 23:59:30 in Kuwait on the 22nd — still the 22nd
    expect(rangeToWindow('today', at('2026-11-22T20:59:30Z')).start.toISOString()).toBe('2026-11-21T21:00:00.000Z');
  });

  test('7 days and 30 days include today', () => {
    const now = at('2026-11-23T11:20:00Z');
    expect(rangeToWindow('7d', now).start.toISOString()).toBe('2026-11-16T21:00:00.000Z');
    expect(rangeToWindow('30d', now).start.toISOString()).toBe('2026-10-24T21:00:00.000Z');
    expect(rangeToWindow('30d', now).end.toISOString()).toBe(now.toISOString());
    // an unknown range is "today"
    expect(rangeToWindow('nonsense', now).start.toISOString()).toBe('2026-11-22T21:00:00.000Z');
  });

  test('the 14-day charts end on today, in Kuwait dates, across a month and a year end', () => {
    const days = lastKuwaitDays(14, at('2025-12-31T22:30:00Z')); // 01:30 on 1 Jan in Kuwait
    expect(days).toHaveLength(14);
    expect(days[13]).toBe('2026-01-01');
    expect(days[12]).toBe('2025-12-31');
    expect(days[0]).toBe('2025-12-19');
    expect(new Set(days).size).toBe(14);
  });

  test('a message at 23:30 UTC belongs to the next Kuwait day', () => {
    expect(kuwaitDayKey(at('2026-11-22T23:30:00Z'))).toBe('2026-11-23');
    expect(kuwaitDayKey(at('2026-11-22T20:59:59Z'))).toBe('2026-11-22');
    expect(kuwaitDayStart(at('2026-11-22T23:30:00Z')).toISOString()).toBe('2026-11-22T21:00:00.000Z');
  });

  test('the service and the independent recount agree on every window', () => {
    const moments = [
      '2026-11-23T11:20:00Z',
      '2026-11-22T21:00:00Z',
      '2026-11-22T20:59:59Z',
      '2026-03-13T20:15:00Z',
      '2026-02-28T22:00:00Z',
      '2024-02-29T10:00:00Z',
      '2025-12-31T22:30:00Z',
    ];
    moments.forEach((iso) => {
      ['today', '7d', '30d'].forEach((range) => {
        expect(rangeToWindow(range, at(iso)).start.toISOString()).toBe(windowOf(range, at(iso)).start.toISOString());
      });
      expect(kuwaitDayKey(at(iso))).toBe(kuwaitDay(at(iso)));
    });
  });
});

describe('recount of an empty inbox', () => {
  test('is all zeros, with the charts keeping their shape', () => {
    const r = recount({ conversations: [], messages: [] }, '30d', at('2026-11-23T11:20:00Z'));
    expect(Object.values(r.overview.kpis).every((v) => v === 0)).toBe(true);
    expect(r.overview.messagesByHour).toHaveLength(24);
    expect(r.overview.messagesPerDay).toHaveLength(14);
    expect(r.overview.waiting).toEqual([]);
    expect(r.team.counselors).toEqual([]);
  });

  test('the wait runs from the first unanswered message; a note does not answer it', () => {
    const now = at('2026-11-23T11:20:00Z');
    const c = { _id: 'c1', status: 'open', contact: { phone: '+965' }, assignees: [{ userId: 'u1' }, { userId: 'u1' }] };
    const m = (direction, iso, extra) => ({ conversation: 'c1', direction, type: 'text', timestamp: at(iso), ...extra });
    const r = recount(
      {
        conversations: [c],
        messages: [
          m('outbound', '2026-11-23T08:00:00Z', { sentByUser: 'u1' }),
          m('inbound', '2026-11-23T09:00:00Z'),
          m('inbound', '2026-11-23T11:00:00Z'),
          m('outbound', '2026-11-23T11:10:00Z', { internal: true, sentByUser: 'u1' }),
        ],
      },
      'today',
      now
    );
    expect(r.overview.kpis.waitingForReply).toBe(1);
    expect(r.overview.waiting[0]).toMatchObject({ waitingSec: 2 * 3600 + 20 * 60, unanswered: 2 });
    // internal notes are not messages
    expect(r.overview.kpis.messagesTotal).toBe(3);
    // one person in two roles on the chat counts once
    expect(r.team.counselors[0]).toMatchObject({ userId: 'u1', pending: 1, openConversations: 1 });
  });
});
