/* eslint-disable no-console */
/**
 * Move students to Enrolled whose application already reached Done.
 *
 * Moving an application to Done through the app enrols the student
 * (application.controller → studentsService.advanceStageToEnrolled). Records
 * written before that existed — or created straight into the database, like
 * the demo seed — can have an application at Done while the student still
 * reads "Applied", so they sit in the wrong Students tab and show up in the
 * counselor desk's "Needs attention".
 *
 * Same rule as the app: a student at Applied / NotApplied with a LIVE,
 * non-rejected application whose current phase is Done → stage Enrolled.
 * Nothing else is touched; no notifications or Slack messages are sent.
 * Each change is logged on the student's timeline.
 *
 *   node scripts/repair-enrolled-stage.js --env=staging                          # list only
 *   node scripts/repair-enrolled-stage.js --env=staging --confirm=upply_staging  # apply
 */
const path = require('path');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v === undefined ? true : v];
  })
);
if (!args.env) {
  console.error('Refusing to guess. Pass --env=staging (or the env file suffix you mean).');
  process.exit(1);
}
process.env.APP_ENV = args.env;
process.env.NODE_ENV = process.env.NODE_ENV || 'development';

// eslint-disable-next-line import/no-dynamic-require, global-require
const config = require(path.join(__dirname, '..', 'src', 'config', 'config'));
const mongoose = require('mongoose');

// Partner submissions / returned / rejected applications are not live.
const NOT_LIVE = ['DRAFT', 'SUBMITTED_BY_SUBAGENT', 'SUBMITTED_BY_COUNSELOR', 'REJECTED', 'RETURNED_FOR_EDIT'];

const currentPhase = (app) => {
  const ph = (app.portalApplicationStatus && app.portalApplicationStatus.applicationPhases) || [];
  const awaiting = ph.find((p) => p && p.phaseState === 'AwaitingResponseStudent');
  const cur = awaiting || ph.find((p) => p && p.isCurrent);
  return cur ? cur.status : null;
};

(async () => {
  await mongoose.connect(config.mongoose.url, config.mongoose.options);
  const { db } = mongoose.connection;
  const dbName = db.databaseName;
  console.log(`Connected to "${dbName}"`);

  const apps = await db
    .collection('applications')
    .find(
      { rejected: { $ne: true }, reviewStatus: { $nin: NOT_LIVE } },
      { projection: { studentId: 1, 'institute.name': 1, portalApplicationStatus: 1 } }
    )
    .toArray();
  const doneBy = new Map();
  apps.forEach((a) => {
    if (currentPhase(a) === 'Done' && a.studentId) doneBy.set(String(a.studentId), a);
  });

  const ids = [...doneBy.keys()]
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => mongoose.Types.ObjectId(id));
  const students = await db
    .collection('students')
    .find(
      { _id: { $in: ids }, stage: { $in: ['Applied', 'NotApplied'] } },
      { projection: { firstName: 1, lastName: 1, stage: 1 } }
    )
    .toArray();

  console.log(`${students.length} student(s) have an application at Done but are not Enrolled:`);
  students.forEach((s) => {
    const a = doneBy.get(String(s._id));
    console.log(
      `  - ${s.firstName || ''} ${s.lastName || ''} (${s.stage}) · ${(a.institute && a.institute.name) || 'application'}`
    );
  });

  if (!args.confirm) {
    console.log('\nList only. Re-run with --confirm=<database name> to apply.');
    await mongoose.disconnect();
    return;
  }
  if (args.confirm !== dbName) {
    console.error(`--confirm=${args.confirm} does not match the connected database "${dbName}". Nothing changed.`);
    await mongoose.disconnect();
    process.exit(1);
  }

  let changed = 0;
  for (const s of students) {
    // eslint-disable-next-line no-await-in-loop
    const res = await db
      .collection('students')
      .updateOne(
        { _id: s._id, stage: { $in: ['Applied', 'NotApplied'] } },
        { $set: { stage: 'Enrolled', updatedAt: new Date() } }
      );
    if (res.modifiedCount) {
      changed += 1;
      const a = doneBy.get(String(s._id));
      // eslint-disable-next-line no-await-in-loop
      await db.collection('activities').insertOne({
        student: s._id,
        type: 'stage',
        text: `Journey complete — student enrolled at ${(a.institute && a.institute.name) || 'their university'} 🎓`,
        actorName: 'System',
        meta: { applicationId: a._id, stageMove: 'Enrolled', repair: true },
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
  }
  console.log(`\nMoved ${changed} student(s) to Enrolled in "${dbName}".`);
  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
