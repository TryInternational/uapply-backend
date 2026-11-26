const {
  Roles,
  User,
  Universities,
  Courses,
  CourseDetails,
  Students,
  Application,
  Documents,
  Comments,
  Note,
  Fees,
  Leads,
  WhatsappConversation,
  WhatsappMessage,
} = require('../../src/models');
const roleAccess = require('../../src/services/roleAccess.service');
const { assertThrowAwayConnection } = require('../utils/setupTestDB');
const { asUserDocument } = require('../factories');
const { buildSeed } = require('./buildSeed');

/**
 * Puts the made-up office in the throw-away test database and returns it.
 *
 *   setupTestDB();
 *   let seed;
 *   beforeEach(async () => { seed = await loadSeed(); });
 *
 * It refuses to write anywhere but the in-memory database a test run starts
 * for itself. Every record is checked against its model as it goes in.
 *
 * Records are inserted, not saved one by one, so the models' save hooks do not
 * run. That is on purpose: the hooks stamp today's date, and the seed's dates
 * must be the same on every run.
 */
const loadSeed = async () => {
  assertThrowAwayConnection();
  const seed = buildSeed();
  const stored = { timestamps: false };

  await Roles.bulkWrite(
    Object.values(seed.roles).map((role) => ({
      updateOne: {
        filter: { _id: role._id },
        update: { $set: { name: role.name, roleRights: role.roleRights } },
        upsert: true,
      },
    }))
  );
  // The role service keeps what it last read; tell it to read again.
  await roleAccess.refresh();

  await User.insertMany(Object.values(seed.users).map(asUserDocument), stored);
  await Universities.insertMany(seed.universities, stored);
  await Courses.insertMany(seed.courses, stored);
  await CourseDetails.insertMany(seed.courseDetails, stored);
  await Students.insertMany(seed.students, stored);
  await Application.insertMany(seed.applications, stored);
  await Documents.insertMany(seed.documents, stored);
  await Comments.insertMany(seed.comments, stored);
  await Note.insertMany(seed.notes, stored);
  await Fees.insertMany(seed.fees, stored);
  await Leads.insertMany(seed.leads, stored);
  await WhatsappConversation.insertMany(seed.conversations, stored);
  await WhatsappMessage.insertMany(seed.messages, stored);

  return seed;
};

// How many records the seed puts in each collection.
const countsOf = (seed) => ({
  roles: Object.keys(seed.roles).length,
  users: Object.keys(seed.users).length,
  universities: seed.universities.length,
  courses: seed.courses.length,
  courseDetails: seed.courseDetails.length,
  students: seed.students.length,
  applications: seed.applications.length,
  documents: seed.documents.length,
  comments: seed.comments.length,
  notes: seed.notes.length,
  fees: seed.fees.length,
  leads: seed.leads.length,
  conversations: seed.conversations.length,
  messages: seed.messages.length,
});

module.exports = { loadSeed, countsOf };
