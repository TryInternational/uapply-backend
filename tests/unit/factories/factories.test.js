const models = require('../../../src/models');
const applicationService = require('../../../src/services/application.service');
const factories = require('../../factories');
const { seedId, isSeedId, kindOfSeedId } = require('../../factories/seedIds');
const { loadSeed } = require('../../seed/loadSeed');

const { build, reset, asUserDocument, PHASES, phasesUpTo, SEED_NOW } = factories;

// Which model each factory's record has to satisfy.
const MODELS = {
  role: models.Roles,
  user: models.User,
  university: models.Universities,
  course: models.Courses,
  courseDetail: models.CourseDetails,
  student: models.Students,
  application: models.Application,
  document: models.Documents,
  comment: models.Comments,
  note: models.Note,
  fee: models.Fees,
  lead: models.Leads,
  conversation: models.WhatsappConversation,
  message: models.WhatsappMessage,
};

// What a factory needs to be told before its record is complete.
const student = seedId('student', 1);
const NEEDS = {
  note: { student },
  message: { conversation: seedId('conversation', 1) },
};

const make = (kind) => build[kind](NEEDS[kind] || {});
const stored = (kind, record) => (kind === 'user' ? asUserDocument(record) : record);

describe('factories', () => {
  beforeEach(() => {
    reset();
  });

  test('there is a factory for every kind of id, and a model for every factory', () => {
    expect(Object.keys(build).sort()).toEqual(Object.keys(MODELS).sort());
  });

  describe.each(Object.keys(MODELS))('%s', (kind) => {
    test('builds a record its model accepts', () => {
      const record = make(kind);
      const error = new MODELS[kind](stored(kind, record)).validateSync();
      expect(error).toBeUndefined();
    });

    test('marks the record as made up, by its id', () => {
      const record = make(kind);
      expect(isSeedId(record._id)).toBe(true);
      expect(kindOfSeedId(record._id)).toBe(kind);
    });

    test('builds the same records again after a reset, and different ones in between', () => {
      const first = make(kind);
      const second = make(kind);
      expect(String(second._id)).not.toBe(String(first._id));
      reset();
      expect(JSON.stringify(make(kind))).toBe(JSON.stringify(first));
    });

    test('lets the caller set any field', () => {
      const record = build[kind]({ ...(NEEDS[kind] || {}), createdAt: new Date('2024-02-29T00:00:00.000Z') });
      expect(record.createdAt.toISOString()).toBe('2024-02-29T00:00:00.000Z');
    });

    test('does not read the clock', () => {
      const dates = Object.values(make(kind)).filter((value) => value instanceof Date);
      dates.forEach((date) => expect(date.getTime()).toBeLessThanOrEqual(SEED_NOW.getTime()));
    });
  });

  describe('made up by construction', () => {
    test('every e-mail address is at example.com', () => {
      ['user', 'student', 'lead'].forEach((kind) => {
        for (let i = 0; i < 30; i += 1) expect(make(kind).email).toMatch(/^[a-z]+\d+@example\.com$/);
      });
    });

    test('every phone number is in the range that cannot exist', () => {
      for (let i = 0; i < 30; i += 1) {
        expect(make('student').phoneNo).toMatch(/^\+9650\d{7}$/);
        expect(make('lead').phoneNo).toMatch(/^\+9650\d{7}$/);
        expect(make('conversation').contact.phone).toMatch(/^\+9650\d{7}$/);
      }
    });

    test('no two students share a phone number, an e-mail address or a reference', () => {
      const students = Array.from({ length: 200 }, () => make('student'));
      ['phoneNo', 'email', 'refrenceNo'].forEach((field) => {
        expect(new Set(students.map((s) => s[field])).size).toBe(students.length);
      });
    });

    test('a document points at no file', () => {
      expect(make('document').blobInfo).toEqual([{ name: 'seed-placeholder-1.pdf', size: 0 }]);
    });
  });

  describe('students', () => {
    test('a stage brings its dates with it, since the seed is stored without the save hooks', () => {
      expect(build.student({ stage: 'NotApplied' })).not.toHaveProperty('appliedAt');
      expect(build.student({ stage: 'Applied' })).toHaveProperty('appliedAt');
      const enrolled = build.student({ stage: 'Enrolled' });
      expect(enrolled.enrolledAt.getTime()).toBeGreaterThan(enrolled.appliedAt.getTime());
      expect(build.student({ stage: 'Lost' })).toHaveProperty('lostAt');
    });
  });

  describe('applications', () => {
    test('the phase list is the one the application uses', () => {
      expect(PHASES).toEqual(applicationService.PIPELINE_PHASES);
    });

    test.each(PHASES)('an application at "%s" has that phase current and the earlier ones completed', (phase) => {
      const { applicationPhases } = build.application({ phase }).portalApplicationStatus;
      const at = PHASES.indexOf(phase);
      expect(applicationPhases.map((p) => p.status)).toEqual(PHASES);
      expect(applicationPhases.filter((p) => p.isCurrent).map((p) => p.status)).toEqual([phase]);
      applicationPhases.forEach((p, index) => {
        let expected = 'Upcoming';
        if (index < at) expected = 'Completed';
        if (index === at) expected = 'AwaitingResponseStudent';
        expect(p.phaseState).toBe(expected);
      });
    });

    test('an unknown phase is refused', () => {
      expect(() => phasesUpTo('Nowhere', SEED_NOW)).toThrow('unknown phase');
    });
  });

  describe('ids', () => {
    test('the same kind and number always give the same id', () => {
      expect(String(seedId('student', 42))).toBe('5eed0003000000000000002a');
    });

    test('an unknown kind or a bad number is refused', () => {
      expect(() => seedId('nothing', 1)).toThrow('unknown kind');
      expect(() => seedId('student', 0)).toThrow('whole number');
    });

    test('an ordinary id is not taken for a made-up one', () => {
      expect(isSeedId('64a000000000000000000001')).toBe(false);
      expect(kindOfSeedId('64a000000000000000000001')).toBeUndefined();
    });
  });

  test('the seed refuses to load when the throw-away test database is not the one open', async () => {
    await expect(loadSeed()).rejects.toThrow();
  });
});
