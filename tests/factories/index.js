const bcrypt = require('bcryptjs');
const { seedId } = require('./seedIds');

/**
 * Factories: each one builds one valid record of one kind, as a plain object.
 *
 * Nothing here is random and nothing reads the clock. The n-th record of a
 * kind is the same every time, so a test can rely on what is in it. A caller
 * passes only what matters to the test; everything else is filled in.
 *
 * Made up by construction, so that no record can be taken for a real one:
 *  - names come from the lists below, and every family name is plainly invented;
 *  - phone numbers start +9650, a range that cannot be dialled;
 *  - e-mail addresses are at example.com, which is reserved for examples;
 *  - every id starts with "5eed" (see seedIds.js).
 *
 * Nothing here is copied from a real record.
 */

// The moment the made-up world is "now". Dates are worked out from it.
const SEED_NOW = new Date('2026-01-15T09:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const daysBefore = (days, from = SEED_NOW) => new Date(from.getTime() - days * DAY);

const GIVEN_NAMES = ['Amal', 'Basil', 'Dana', 'Faris', 'Ghada', 'Hadi', 'Iman', 'Jad', 'Lina', 'Majed', 'Noor', 'Omar'];
const FAMILY_NAMES = ['Testwell', 'Sampleton', 'Mockridge', 'Fixture', 'Demoson', 'Placeholder', 'Specimen', 'Dummyford'];

const pick = (list, n) => list[(n - 1) % list.length];
const givenName = (n) => pick(GIVEN_NAMES, n);
// The number keeps two people from sharing a whole name when the lists wrap round.
const familyName = (n) =>
  `${pick(FAMILY_NAMES, n)}${n > FAMILY_NAMES.length ? ` ${Math.ceil(n / FAMILY_NAMES.length)}` : ''}`;

/** A phone number that cannot exist: +9650 and seven digits. */
const phone = (kind, n) => `+9650${String(kind).padStart(2, '0')}${String(n).padStart(5, '0')}`;
const email = (label, n) => `${label}${n}@example.com`;

// One password for every made-up user, hashed once. insertMany does not run the
// model's save hook, so the hash is stored as it is.
const PASSWORD = 'password1';
const HASHED_PASSWORD = bcrypt.hashSync(PASSWORD, bcrypt.genSaltSync(4));

// How many of each kind have been built. reset() starts every count again.
let counts = {};
const next = (kind) => {
  counts[kind] = (counts[kind] || 0) + 1;
  return counts[kind];
};
const reset = () => {
  counts = {};
};

const role = (overrides = {}) => {
  const n = next('role');
  return { _id: seedId('role', n), name: `Seed role ${n}`, roleRights: [], ...overrides };
};

/**
 * A user. `password` is the plain password, for signing in through the API;
 * `hashedPassword` is what goes in the database (see asUserDocument).
 */
const user = (overrides = {}) => {
  const n = next('user');
  return {
    _id: seedId('user', n),
    name: `${givenName(n)} ${familyName(n)}`,
    email: email('user', n),
    password: PASSWORD,
    createdAt: daysBefore(400),
    updatedAt: daysBefore(400),
    ...overrides,
  };
};

/** The user as it is stored: the same record with the password hashed. */
const asUserDocument = (aUser) => ({ ...aUser, password: HASHED_PASSWORD });

const university = (overrides = {}) => {
  const n = next('university');
  return {
    _id: seedId('university', n),
    name: `Seed University ${n}`,
    institutionRefId: `seed-inst-${n}`,
    slug: `seed-university-${n}`,
    country: 'United Kingdom',
    ...overrides,
  };
};

const course = (overrides = {}) => {
  const n = next('course');
  return {
    _id: seedId('course', n),
    courseRefId: `seed-course-${n}`,
    name: `Seed Course ${n}`,
    slug: `seed-course-${n}`,
    courseLevel: 'Undergraduate',
    currency: 'GBP',
    approxAnnualFee: 15000 + n * 500,
    // The course list is asked for by country, so a course with no place is
    // one no screen can show.
    locations: [{ key: 'United Kingdom', value: 'London' }],
    intakeMonths: ['September', 'January'],
    attendanceTypes: ['FullTime'],
    ...overrides,
  };
};

/**
 * What a course's own page says about it, which is kept apart from the course
 * (the two are joined by `courseRefId`). An application is made from this: it
 * gives the months a student can start in, the campuses, and the university
 * the application is stored with. Pass the course's own `courseRefId`, `name`
 * and `courseLevel`, and its university as `institution`.
 */
const courseDetail = (overrides = {}) => {
  const n = next('courseDetail');
  return {
    _id: seedId('courseDetail', n),
    courseRefId: `seed-course-${n}`,
    name: `Seed Course ${n}`,
    slug: `seed-course-${n}`,
    courseLevel: 'Undergraduate',
    locations: [{ key: 'United Kingdom', value: 'London' }],
    institution: { name: `Seed University ${n}`, slug: `seed-university-${n}` },
    courseIntakes: [{ intakeMonth: 'September' }, { intakeMonth: 'January' }],
    campusList: [{ name: 'Seed Main Campus' }],
    courseSummary: 'A made-up course, for tests.',
    ...overrides,
  };
};

/**
 * A student. Pass `createdBy` and `assignedTo` to say whose it is.
 * The dates that the model stamps on save are set here, because the seed is
 * inserted without the save hooks and must not depend on the clock.
 */
const student = (overrides = {}) => {
  const n = next('student');
  const createdAt = overrides.createdAt || daysBefore(60 + n);
  const stage = overrides.stage || 'NotApplied';
  const stageDates = {};
  if (stage === 'Applied' || stage === 'Enrolled') stageDates.appliedAt = new Date(createdAt.getTime() + 3 * DAY);
  if (stage === 'Enrolled') stageDates.enrolledAt = new Date(createdAt.getTime() + 30 * DAY);
  if (stage === 'Lost') stageDates.lostAt = new Date(createdAt.getTime() + 10 * DAY);
  return {
    _id: seedId('student', n),
    firstName: givenName(n),
    lastName: familyName(n),
    email: email('student', n),
    phoneNo: phone(3, n),
    refrenceNo: `SEED-${String(n).padStart(4, '0')}`,
    gender: n % 2 ? 'Female' : 'Male',
    stage,
    source: 'uapply',
    channel: 'direct',
    applications: [],
    assignedTo: [],
    qualified: false,
    createdAt,
    updatedAt: createdAt,
    ...stageDates,
    ...overrides,
  };
};

// The phases an application moves through, in order. The same list as
// PHASE_ORDER in src/controllers/application.controller.js; the seed's own test
// checks the two have not drifted apart.
const PHASES = [
  'Initiated',
  'Submitted',
  'Conditional offer',
  'Unconditional offer',
  'Confirmation',
  'FG/BS',
  'CAS Received',
  'Done',
];

/** The phase list of an application that has got as far as `phase`. */
const phasesUpTo = (phase, startedAt) => {
  const reached = PHASES.indexOf(phase);
  if (reached === -1) throw new Error(`phasesUpTo: unknown phase "${phase}"`);
  return PHASES.map((status, index) => {
    const at = new Date(startedAt.getTime() + index * 7 * DAY);
    let phaseState = 'Upcoming';
    if (index < reached) phaseState = 'Completed';
    if (index === reached) phaseState = 'AwaitingResponseStudent';
    return {
      status,
      phaseState,
      isCurrent: index === reached,
      isPrevious: index === reached - 1,
      ...(index <= reached ? { createdDate: at, updatedDate: at } : {}),
      subApplicationPhase: [],
    };
  });
};

/** An application. Pass `studentId`, and `phase` to say how far it has got. */
const application = (overrides = {}) => {
  const n = next('application');
  const { phase = 'Initiated', ...rest } = overrides;
  const createdAt = rest.createdAt || daysBefore(50 + n);
  return {
    _id: seedId('application', n),
    applicationId: `SEED-APP-${String(n).padStart(4, '0')}`,
    agent: 'Ulearn',
    courseLevel: 'Undergraduate',
    courseName: `Seed Course ${n}`,
    intakeYear: 2026,
    intakeMonth: 'September',
    finalChoice: false,
    reviewStatus: 'APPROVED',
    reviewHistory: [],
    stageRecords: [],
    portalApplicationStatus: { applicationPhases: phasesUpTo(phase, createdAt) },
    createdAt,
    updatedAt: createdAt,
    ...rest,
  };
};

const DOCUMENT_TYPES = [
  'Passport',
  'Academic Transcript',
  'English Test',
  'Personal Statement',
  'Reference Letter',
  'Civil ID',
];

/** A document record. It points at no file: `blobInfo` holds a placeholder name only. */
const document = (overrides = {}) => {
  const n = next('document');
  const documentType = overrides.documentType || pick(DOCUMENT_TYPES, n);
  return {
    _id: seedId('document', n),
    documentType,
    docState: 'Upload',
    blobInfo: [{ name: `seed-placeholder-${n}.pdf`, size: 0 }],
    createdAt: daysBefore(40 + n),
    updatedAt: daysBefore(40 + n),
    ...overrides,
  };
};

/** A comment on a student. Pass `studentId` and `author` (a user from the factory). */
const comment = (overrides = {}) => {
  const n = next('comment');
  const { author, ...rest } = overrides;
  const at = rest.dateTime || daysBefore(20 + n);
  return {
    _id: seedId('comment', n),
    content: `Seed comment ${n}, written for a test.`,
    dateTime: at,
    createdBy: author ? author.name : 'Seed author',
    ...(author ? { userId: author._id } : {}),
    createdAt: at,
    updatedAt: at,
    ...rest,
  };
};

/** A note on a student. Pass `student` (an id) and `author`. */
const note = (overrides = {}) => {
  const n = next('note');
  const { author, ...rest } = overrides;
  const at = rest.createdAt || daysBefore(15 + n);
  return {
    _id: seedId('note', n),
    body: `Seed note ${n}, written for a test.`,
    ...(author ? { authorId: author._id, authorName: author.name } : {}),
    pinned: false,
    createdAt: at,
    updatedAt: at,
    ...rest,
  };
};

const FEE_TYPES = ['ielts-booking', 'office-fees', 'student-visa', 'english-self-funded'];

const fee = (overrides = {}) => {
  const n = next('fee');
  const at = overrides.createdDate || daysBefore(n);
  return {
    _id: seedId('fee', n),
    feeType: pick(FEE_TYPES, n),
    tag: { amount: 100 + n, currency: 'KWD', note: `Seed fee ${n}` },
    createdDate: at,
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
};

const LEAD_STATUSES = ['New', 'Sent Whatsapp', 'Applied', 'Converted'];

const lead = (overrides = {}) => {
  const n = next('lead');
  const at = overrides.createdAt || daysBefore(10 + n);
  return {
    _id: seedId('lead', n),
    fullname: `${givenName(n + 3)} ${familyName(n + 2)}`,
    email: email('lead', n),
    phoneNo: phone(9, n),
    status: 'New',
    source: 'uapply',
    qualified: false,
    applications: [],
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
};

/** A WhatsApp conversation. Pass `assignees` and `student` to link it. */
const conversation = (overrides = {}) => {
  const n = next('conversation');
  const at = overrides.lastMessageAt || daysBefore(n);
  return {
    _id: seedId('conversation', n),
    contact: { phone: phone(10, n), name: `${givenName(n + 5)} ${familyName(n + 4)}`, waId: phone(10, n).replace('+', '') },
    assignees: [],
    lastMessage: { preview: `Seed message for conversation ${n}`, at, direction: 'inbound' },
    lastMessageAt: at,
    unreadCount: 0,
    status: 'open',
    priority: 'medium',
    tags: [],
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
};

/** A WhatsApp message. Pass `conversation` (an id) and `direction`. */
const message = (overrides = {}) => {
  const n = next('message');
  const at = overrides.timestamp || daysBefore(n);
  return {
    _id: seedId('message', n),
    waMessageId: `seed.wamid.${n}`,
    direction: 'inbound',
    type: 'text',
    text: `Seed message ${n}, written for a test.`,
    status: 'delivered',
    timestamp: at,
    internal: false,
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
};

module.exports = {
  SEED_NOW,
  DAY,
  daysBefore,
  PASSWORD,
  PHASES,
  DOCUMENT_TYPES,
  FEE_TYPES,
  LEAD_STATUSES,
  phasesUpTo,
  reset,
  asUserDocument,
  build: {
    role,
    user,
    university,
    course,
    courseDetail,
    student,
    application,
    document,
    comment,
    note,
    fee,
    lead,
    conversation,
    message,
  },
};
