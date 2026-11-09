/* eslint-disable no-console */
/**
 * Read-only tally of what the Trello import put in STAGING — nothing is written.
 *   node scripts/count-trello-staging.js
 * Trello-imported students carry refrenceNo "TR-<card>"; the demo WhatsApp
 * chats carry the tag "demo".
 */
const path = require('path');

process.env.APP_ENV = 'staging';
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
const mongoose = require('mongoose');
// eslint-disable-next-line import/no-dynamic-require
const config = require(path.join(__dirname, '..', 'src', 'config', 'config'));

(async () => {
  await mongoose.connect(config.mongoose.url, config.mongoose.options);
  const db = mongoose.connection;
  const S = db.collection('students');
  const tr = { refrenceNo: /^TR-/ };
  const n = async (c, q) => db.collection(c).countDocuments(q);
  const trIds = await S.find(tr)
    .project({ _id: 1 })
    .map((d) => d._id)
    .toArray();
  const inTr = { studentId: { $in: trIds } };
  const byStage = await S.aggregate([
    { $match: tr },
    { $group: { _id: '$stage', n: { $sum: 1 } } },
    { $sort: { n: -1 } },
  ]).toArray();
  console.log(`database ${db.name}`);
  console.log(
    `students: ${await n('students', {})} total · ${trIds.length} from Trello · ${await n('students', {
      ...tr,
      labels: 'Archived',
    })} archived · ${await n('students', { ...tr, labels: 'Hot' })} hot`
  );
  console.log(`  by stage: ${byStage.map((x) => `${x._id} ${x.n}`).join(' · ')}`);
  console.log(
    `  with dob ${await n('students', { ...tr, dob: { $ne: null } })} · passport no ${await n('students', {
      ...tr,
      passportNo: { $nin: [null, ''] },
    })} · civil id ${await n('students', { ...tr, civilNumber: { $nin: [null, ''] } })} · no phone ${await n('students', {
      ...tr,
      $or: [{ phoneNo: '-' }, { phoneNo: null }, { phoneNo: '' }],
    })}`
  );
  console.log(
    `applications: ${await n('applications', inTr)} · comments: ${await n('comments', inTr)} · documents: ${await n(
      'documents',
      inTr
    )} · notes: ${await n('notes', { student: { $in: trIds } })} · activities: ${await n('activities', {
      student: { $in: trIds },
    })}`
  );
  const docsNoFile = await n('documents', {
    ...inTr,
    $or: [{ 'blobInfo.0.blobUrl': { $exists: false } }, { 'blobInfo.0.blobUrl': '' }],
  });
  console.log(`  documents without a file url: ${docsNoFile}`);
  const unis = await db
    .collection('applications')
    .aggregate([{ $match: { ...inTr, $or: [{ 'institute.name': null }, { 'institute.name': '' }] } }, { $count: 'n' }])
    .toArray();
  console.log(`  applications with no university name: ${unis[0] ? unis[0].n : 0}`);
  console.log(
    `whatsapp: ${await n('whatsappconversations', {})} chats (${await n('whatsappconversations', {
      tags: 'demo',
    })} demo) · ${await n('whatsappmessages', {})} messages · leads ${await n('leads', {})} (${await n('leads', {
      webUrl: 'demo://whatsapp-inbox-seed',
    })} demo)`
  );
  await mongoose.disconnect();
})().catch(async (e) => {
  console.error(e.message || e);
  try {
    await mongoose.disconnect();
  } catch (_) {
    /* ignore */
  }
  process.exit(1);
});
