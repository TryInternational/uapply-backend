/**
 * "Same time last year" for students who applied: last year's month in progress
 * is counted up to today's day of the month (Kuwait), not estimated from the
 * whole month; and each student who applied in a range comes with the date.
 */
const rows = [];
jest.mock('../../../src/models', () => ({
  Application: { aggregate: async () => rows.map((r) => ({ student: r.student, at: r.at })) },
  Students: { find: () => ({ lean: async () => [] }) },
}));
jest.mock('../../../src/config/config', () => ({ env: 'test' }));

const { getAppliedStudentsByMonth, appliedStudentsBetween } = require('../../../src/services/application.service');

beforeEach(() => {
  rows.length = 0;
});

test('lastYearToDay stops at today’s day of the month, in Kuwait time', async () => {
  rows.push(
    { student: 'a', at: new Date('2025-10-05T09:00:00Z') },
    { student: 'b', at: new Date('2025-11-03T09:00:00Z') },
    // 23 Nov 22:30 UTC is already the 24th in Kuwait
    { student: 'c', at: new Date('2025-11-23T22:30:00Z') },
    { student: 'd', at: new Date('2025-11-23T12:00:00Z') },
    { student: 'e', at: new Date('2025-11-28T09:00:00Z') },
    { student: 'f', at: new Date('2026-11-10T09:00:00Z') }
  );
  const out = await getAppliedStudentsByMonth(2026, new Date('2026-11-23T10:00:00Z'));
  expect(out.lastYear[10]).toBe(4);
  expect(out.lastYearToDay[10]).toBe(2);
  expect(out.lastYearToDay[9]).toBe(1);
  expect(out.thisYear[10]).toBe(1);
});

test('appliedStudentsBetween gives each student their first applied date in the range', async () => {
  rows.push(
    { student: 'a', at: new Date('2025-03-01T00:00:00Z') },
    { student: 'a', at: new Date('2026-11-12T00:00:00Z') },
    { student: 'a', at: new Date('2026-11-04T00:00:00Z') },
    { student: 'b', at: new Date('2026-09-01T00:00:00Z') }
  );
  const got = await appliedStudentsBetween('2026-11-01T00:00:00Z', '2026-11-30T00:00:00Z');
  expect(Array.from(got.keys())).toEqual(['a']);
  expect(got.get('a').toISOString()).toBe('2026-11-04T00:00:00.000Z');
});
