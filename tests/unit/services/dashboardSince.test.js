/**
 * "Of the students who applied in a period, how many have an offer / enrolled"
 * counts from the moment they applied. A student back for a new intake used to
 * bring an enrolment from an earlier year along (Conversion 8% beside 0 enrolled).
 */
jest.mock('../../../src/models', () => ({}));
jest.mock('../../../src/config/config', () => ({ env: 'test' }));

const { enrolledSince, appsSince } = require('../../../src/services/dashboardBreakdowns.service');

const at = new Date('2026-11-02T08:00:00Z');

describe('enrolledSince', () => {
  test('enrolled now counts by the enrolment date', () => {
    expect(enrolledSince({ stage: 'Enrolled', enrolledAt: '2026-11-10T00:00:00Z' }, at)).toBe(true);
    expect(enrolledSince({ stage: 'Enrolled', enrolledAt: '2025-09-01T00:00:00Z' }, at)).toBe(false);
    // enrolled before the date was recorded: nothing says it was earlier
    expect(enrolledSince({ stage: 'Enrolled' }, at)).toBe(true);
  });

  test('an earlier journey that ended Enrolled counts only when it closed after they applied', () => {
    const back = (closedAt) => ({
      stage: 'Applied',
      enrolledAt: '2025-09-01T00:00:00Z',
      journeys: [{ outcome: 'Enrolled', closedAt }],
    });
    // enrolled last year, came back for a new intake and applied on 2 Nov
    expect(enrolledSince(back('2026-10-20T00:00:00Z'), at)).toBe(false);
    // applied on 2 Nov, enrolled, and has since opened the next journey
    expect(enrolledSince(back('2026-11-20T00:00:00Z'), at)).toBe(true);
    expect(enrolledSince({ stage: 'Applied', journeys: [{ outcome: 'Lost', closedAt: '2026-11-20T00:00:00Z' }] }, at)).toBe(
      false
    );
  });

  test('with no applied date it is "ever enrolled"', () => {
    const s = { stage: 'Applied', journeys: [{ outcome: 'Enrolled', closedAt: '2024-01-01T00:00:00Z' }] };
    expect(enrolledSince(s, null)).toBe(true);
    expect(enrolledSince({ stage: 'Applied' }, null)).toBe(false);
    expect(enrolledSince(null, at)).toBe(false);
  });
});

describe('appsSince', () => {
  test('keeps the applications made from the applied date on', () => {
    const list = [
      { _id: 'old', createdAt: '2025-03-01T00:00:00Z' },
      { _id: 'first', createdAt: '2026-11-02T08:00:00Z' },
      { _id: 'later', createdAt: '2026-11-15T00:00:00Z' },
      { _id: 'undated' },
    ];
    expect(appsSince(list, at).map((a) => a._id)).toEqual(['first', 'later', 'undated']);
    expect(appsSince(list, null)).toHaveLength(4);
    expect(appsSince(undefined, at)).toEqual([]);
  });
});
