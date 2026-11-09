/* eslint-disable no-console, no-await-in-loop, no-restricted-syntax, no-continue, security/detect-non-literal-fs-filename */
/**
 * Import Trello cards into the CRM database.
 *
 * Input is the folder that the Trello export's `tools/transform.py` writes
 * (students.jsonl, applications.jsonl, comments.jsonl, notes.jsonl,
 * activities.jsonl, documents.jsonl). Nothing here talks to Trello.
 *
 * WHY A SCRIPT AND NOT THE API
 *   The API stamps every record with today's date and runs the controllers'
 *   side effects (Slack messages, in-app notifications). This writes through
 *   the Mongoose models directly, so the original Trello dates survive and
 *   nobody is notified. Models used: Students, Application, Comments, Note,
 *   Activity, Documents — none of them has a hook that notifies anyone.
 *
 * SAFETY
 *   • Staging only (--env=staging). Production is refused outright for now.
 *   • Dry run by default: it connects, resolves users / levels / countries /
 *     universities, and prints exactly what it would create. Nothing is written.
 *   • Writing needs --confirm=<database name>, typed back and checked against
 *     the database actually connected to (same rule as wipe-data.js).
 *   • Re-runnable: a student is found again by refrenceNo "TR-<card>", an
 *     application by applicationId "TR-<card>:<checklist>", so a second run
 *     updates instead of duplicating.
 *   • Every record it CREATES (and every file it uploads) is listed in
 *     import-manifest-<time>.json in the input folder; --rollback=<manifest>
 *     removes exactly those again.
 *
 * FILES
 *   Uploaded to the Firebase Storage bucket the back office already uses, under
 *   trello-import/staging/<card>/…, the same way the app uploads (download URL
 *   with a token). A file already there is reused, not uploaded twice.
 *
 *   node scripts/import-trello.js --env=staging --dir="<export>/shaped/pilot"
 *   node scripts/import-trello.js --env=staging --dir="<export>/shaped/pilot" --confirm=upply_staging
 *   node scripts/import-trello.js --env=staging --rollback="<export>/shaped/pilot/import-manifest-….json" --confirm=upply_staging
 *
 * Options: --files-root=<export folder> (default: two levels above --dir),
 *          --skip-files (records only), --bucket=<firebase bucket>.
 */
const path = require('path');
const fs = require('fs');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.length ? v.join('=') : true];
  })
);
if (!args.env) {
  console.error('Refusing to guess which database. Pass --env=staging');
  process.exit(1);
}
if (args.env !== 'staging') {
  console.error('This importer only writes to staging for now. Pass --env=staging');
  process.exit(1);
}
if (!args.dir && !args.rollback) {
  console.error('Pass --dir=<shaped folder> (or --rollback=<manifest>).');
  process.exit(1);
}
process.env.APP_ENV = args.env;
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
// eslint-disable-next-line import/no-dynamic-require
const config = require(path.join(__dirname, '..', 'src', 'config', 'config'));
const mongoose = require('mongoose');
const validator = require('validator');
// eslint-disable-next-line import/no-dynamic-require
const models = require(path.join(__dirname, '..', 'src', 'models'));

const { Students, Application, Comments, Note, Activity, Documents, User, CourseLevels, Countries, Universities } = models;
const BUCKET = args.bucket || 'ulearn-abroad.firebasestorage.app';
const PREFIX = 'trello-import/staging/';
const STORAGE = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o`;
const NO_TS = { timestamps: false };

const readJsonl = (file) =>
  fs.existsSync(file)
    ? fs
        .readFileSync(file, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];
const date = (v) => (v ? new Date(v) : undefined);
const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/* ---------------------------------------------------------------- files */
const objectUrl = (name, token) => `${STORAGE}/${encodeURIComponent(name)}?alt=media&token=${token}`;
// a dropped connection or a stalled upload (fetch throws) is retried like an error reply
async function withRetry(what, fn, attempts = 5) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (e) {
      if (attempt === attempts) throw new Error(`${what}: ${e.cause ? e.cause.code || e.cause.message : e.message}`);
      console.log(
        `    … ${what} failed (${e.cause ? e.cause.code || e.cause.message : e.message}), retrying in ${5 * attempt}s`
      );
      await new Promise((res) => {
        setTimeout(res, 5000 * attempt);
      });
    }
  }
  return null;
}
async function existingUpload(name) {
  const r = await withRetry(`check ${path.basename(name)}`, () => fetch(`${STORAGE}/${encodeURIComponent(name)}`));
  if (!r.ok) return null;
  const meta = await r.json();
  const token = String(meta.downloadTokens || '').split(',')[0];
  return token ? objectUrl(name, token) : null;
}
async function upload(localFile, name, mimeType) {
  if (!name.startsWith(PREFIX)) throw new Error(`refusing to upload outside ${PREFIX}: ${name}`);
  const found = await existingUpload(name);
  if (found) return { url: found, uploaded: false };
  const body = fs.readFileSync(localFile);
  const label = `upload ${path.basename(localFile)} (${(body.length / 1e6).toFixed(1)} MB)`;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const r = await withRetry(label, () =>
      fetch(`${STORAGE}?name=${encodeURIComponent(name)}`, {
        method: 'POST',
        headers: { 'Content-Type': mimeType || 'application/octet-stream' },
        body,
      })
    );
    if (r.ok) {
      const meta = await r.json();
      return { url: objectUrl(meta.name, String(meta.downloadTokens).split(',')[0]), uploaded: true };
    }
    if (attempt === 4) throw new Error(`upload failed ${r.status} ${(await r.text()).slice(0, 160)}`);
    await new Promise((res) => {
      setTimeout(res, 1500 * attempt);
    });
  }
  return null;
}

/* ---------------------------------------------------------------- lookups */
async function buildLookups(students, apps, comments) {
  const emails = new Set();
  students.forEach((s) => (s.team || []).forEach((t) => emails.add(t.email)));
  comments.forEach((c) => {
    if (c.userEmail) emails.add(c.userEmail);
    (c.taggedEmails || []).forEach((e) => emails.add(e));
  });
  const users = await User.find({ email: { $in: [...emails] } }).lean();
  const userByEmail = new Map(users.map((u) => [String(u.email).toLowerCase(), u]));

  const levels = await CourseLevels.find({}).lean();
  const levelRules = [
    ['Foundation', /foundation/],
    ["Bachelor's", /bachelor|undergrad|degree/],
    ["Master's", /master|postgrad/],
    ['PhD', /phd|doctor/],
  ];
  const levelByName = new Map();
  levelRules.forEach(([name, rx]) => {
    const hit = levels.find((l) => rx.test(String(l.en_name || '').toLowerCase()));
    if (hit) levelByName.set(name, hit);
  });

  const countryNames = [...new Set(students.flatMap((s) => [s.nationalityName, s.residenceName]).filter(Boolean))];
  const countries = await Countries.find({ english_name: { $in: countryNames } }).lean();
  const countryByName = new Map(countries.map((c) => [c.english_name, c]));

  const unis = await Universities.find({}, 'name logoUrl country slug institution').lean();
  const uniByNorm = new Map(unis.map((u) => [norm(u.name), u]));
  // Exact name first; otherwise only a match on the distinctive words (generic words such as
  // "University", "of", "London" removed; "College" is kept, so University College Birmingham never
  // matches the University of Birmingham), so "City St George's, University of London" can never
  // land on a plain "University of London". Every non-exact match is listed in the dry run.
  const GENERIC = new Set(['university', 'of', 'the', 'london', 'st', 'and', 'in', 'at', 'uk']);
  const keyOf = (n) =>
    norm(n)
      .split(' ')
      .filter((w) => w && !GENERIC.has(w))
      .sort()
      .join(' ');
  const uniByKey = new Map();
  unis.forEach((u) => {
    const k = keyOf(u.name);
    if (k && !uniByKey.has(k)) uniByKey.set(k, u);
  });
  const approx = new Map();
  const uniFor = (name) => {
    if (!name) return null;
    const exact = uniByNorm.get(norm(name));
    if (exact) return exact;
    const hit = uniByKey.get(keyOf(name)) || null;
    if (hit) approx.set(name, hit.name);
    return hit;
  };
  const uniNames = [...new Set(apps.map((a) => a.universityName).filter(Boolean))];
  return { userByEmail, levelByName, countryByName, uniFor, uniNames, approx };
}

/* ---------------------------------------------------------------- shapes */
const plain = (doc) => {
  if (!doc) return undefined;
  const { _id, __v, ...rest } = doc;
  return { ...rest, id: String(_id) };
};
function studentDoc(s, L) {
  const team = [];
  (s.team || []).forEach((t) => {
    const u = L.userByEmail.get(t.email);
    if (u && !team.some((x) => String(x.user) === String(u._id) && x.role === t.role)) {
      team.push({ user: u._id, role: t.role, userRole: u.role });
    }
  });
  const level = L.levelByName.get(s.preference.courseLevelName);
  const email = s.email && validator.isEmail(s.email) ? s.email : undefined;
  return {
    firstName: s.firstName || '-',
    middleName: s.middleName || undefined,
    lastName: s.lastName || '-',
    phoneNo: s.phoneNo || '-',
    ...(email ? { email } : {}),
    address: s.address || undefined,
    emergencyContact: (s.emergencyContact || []).map((e) => ({
      ...e,
      email: e.email && validator.isEmail(e.email) ? e.email : undefined,
    })),
    nationality: plain(L.countryByName.get(s.nationalityName)),
    residence: plain(L.countryByName.get(s.residenceName)),
    stage: s.stage,
    lostReason: s.lostReason || undefined,
    // the day the Trello card moved into Done / Lost (dashboards count by these)
    enrolledAt: date(s.enrolledAt),
    lostAt: date(s.lostAt),
    preference: {
      courseLevel: level ? String(level._id) : undefined,
      intakeMonth: s.preference.intakeMonth || undefined,
      intakeYear: s.preference.intakeYear || undefined,
      courseSubjectIds: s.preference.courseSubjectIds || [],
      universities: s.preference.universities || [],
      destinations: s.preference.destinations || [],
      sponsoredBy: s.preference.sponsoredBy || undefined,
      kcoStatus: s.preference.kcoStatus || undefined,
      provider: s.preference.provider || undefined,
    },
    sourceOfFund: s.sourceOfFund || undefined,
    channel: s.channel || 'direct',
    ambassadorName: s.ambassadorName || undefined,
    previousSchool: s.previousSchool || undefined,
    // read from the student's own files on the Mac (tools/extract_fields.py)
    dob: s.dob ? date(s.dob) : undefined,
    gender: s.gender || undefined,
    passportNo: s.passportNo || undefined,
    passportExpiry: s.passportExpiry || undefined,
    civilNumber: s.civilNumber || undefined,
    englishTest: s.englishTest || undefined,
    testScore: s.testScore || undefined,
    testTaken: s.testTaken || undefined,
    cgpa: s.cgpa || undefined,
    labels: s.labels || [],
    assignedTo: team,
    credentials: s.credentials || [],
    importantComment: s.importantComment || undefined,
    refrenceNo: s.ref,
    source: 'ulearn',
    qualified: s.stage !== 'NotApplied',
    appliedAt: date(s.appliedAt),
    createdAt: date(s.createdAt),
    updatedAt: date(s.updatedAt) || date(s.createdAt),
  };
}
function applicationDoc(a, studentId, L) {
  const uni = L.uniFor(a.universityName);
  const notes = [
    `Imported from Trello checklist "${a.rawName}".`,
    a.reference ? `Reference: ${a.reference}` : null,
    a.closedStatus ? `Closed: ${a.closedStatus}` : null,
    ...(a.notes || []),
  ].filter(Boolean);
  return {
    studentId,
    applicationId: a.ref,
    institute: uni
      ? { name: uni.name, logoUrl: uni.logoUrl, country: uni.country, slug: uni.slug }
      : { name: a.universityName || a.rawName },
    provider: a.provider || undefined,
    agent: ['Ulearn', 'SIUK', 'GESCO'].includes(a.agent) ? a.agent : 'Ulearn',
    courseLevel: a.courseLevelName || undefined,
    bachelorYear: a.bachelorYear || '',
    intakeMonth: a.intakeMonth || undefined,
    intakeYear: a.intakeYear || undefined,
    rejected: !!a.rejected,
    finalChoice: !!a.finalChoice,
    status: a.status && a.status.length ? a.status : ['Status 3'],
    comments: notes.join('\n'),
    reviewStatus: 'APPROVED',
    portalApplicationStatus: {
      applicationPhases: a.phases.map((p) => ({
        status: p.status,
        phaseState: p.phaseState,
        isCurrent: p.isCurrent,
        isPrevious: p.isPrevious,
        createdDate: date(p.createdDate),
        updatedDate: date(p.updatedDate),
        subApplicationPhase: [],
      })),
    },
    stageRecords: (a.stageRecords || []).map((r) => ({
      stage: r.stage,
      note: r.note,
      byName: r.byName,
      at: date(r.at),
      fields: { trelloChecklistId: a.trelloChecklistId },
    })),
    createdAt: date(a.createdAt),
    updatedAt: date(a.updatedAt) || date(a.createdAt),
  };
}

/* ---------------------------------------------------------------- comment content */
const escHtml = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// The transform writes Trello Markdown as the CRM's HTML. Two things can only be
// finished here: links to Trello attachments point at the CRM copy of the file,
// and @mentions use the CRM user's own name so the thread highlights them.
function crmCommentContent(c, urlByAtt, L) {
  let out = c.content || '';
  out = out.replace(/<a href="trello-attachment:([0-9a-f]{24})"([^>]*)>([\s\S]*?)<\/a>/g, (m, id, rest, label) => {
    const url = urlByAtt.get(id);
    return url ? `<a href="${escHtml(url)}"${rest}>${label}</a>` : `${label} (file deleted in Trello)`;
  });
  Object.entries(c.mentions || {})
    .sort((a, b) => b[0].length - a[0].length)
    .forEach(([name, email]) => {
      const u = L.userByEmail.get(email);
      if (u && u.name && u.name !== name) out = out.split(`@${escHtml(name)}`).join(`@${escHtml(u.name)}`);
    });
  return out;
}

/* ---------------------------------------------------------------- upsert helpers */
async function upsert(Model, filter, doc, manifestList) {
  const existing = await Model.findOne(filter).lean();
  if (existing) {
    await Model.updateOne({ _id: existing._id }, { $set: doc }, NO_TS);
    return { id: existing._id, created: false };
  }
  const created = new Model(doc);
  await created.save(NO_TS);
  manifestList.push(String(created._id));
  return { id: created._id, created: true };
}

/* ---------------------------------------------------------------- rollback */
async function rollback(file, write) {
  const m = JSON.parse(fs.readFileSync(file, 'utf8'));
  const plan = [
    ['documents', Documents],
    ['activities', Activity],
    ['notes', Note],
    ['comments', Comments],
    ['applications', Application],
    ['students', Students],
  ];
  plan.forEach(([k]) => console.log(`  ${k.padEnd(13)} ${(m[k] || []).length}`));
  console.log(`  files         ${(m.files || []).length}`);
  if (!write) {
    console.log('\nDry run. Add --confirm=<database name> to remove exactly these records and files.');
    return;
  }
  for (const [k, Model] of plan) {
    const ids = m[k] || [];
    if (ids.length) {
      const r = await Model.deleteMany({ _id: { $in: ids } });
      console.log(`  removed ${String(r.deletedCount).padStart(5)} ${k}`);
    }
  }
  let removed = 0;
  for (const name of m.files || []) {
    if (!name.startsWith(PREFIX)) continue;
    const r = await fetch(`${STORAGE}/${encodeURIComponent(name)}`, { method: 'DELETE' });
    if (r.ok || r.status === 404) removed += 1;
  }
  console.log(`  removed ${String(removed).padStart(5)} files`);
}

/* ---------------------------------------------------------------- main */
async function main() {
  await mongoose.connect(config.mongoose.url, config.mongoose.options);
  const dbName = mongoose.connection.name;
  console.log(`Connected to database "${dbName}" (APP_ENV=${args.env}).`);
  if (args.confirm && args.confirm !== dbName) {
    console.error(`--confirm=${args.confirm} does not match the connected database "${dbName}". Nothing written.`);
    process.exit(1);
  }
  const write = args.confirm === dbName;

  if (args.rollback) {
    console.log(`Rollback from ${args.rollback}:`);
    await rollback(args.rollback, write);
    return;
  }

  const dir = path.resolve(args.dir);
  const filesRoot = path.resolve(args['files-root'] || path.join(dir, '..', '..'));
  const students = readJsonl(path.join(dir, 'students.jsonl'));
  const apps = readJsonl(path.join(dir, 'applications.jsonl'));
  const comments = readJsonl(path.join(dir, 'comments.jsonl'));
  const notes = readJsonl(path.join(dir, 'notes.jsonl'));
  const activities = readJsonl(path.join(dir, 'activities.jsonl'));
  const docs = readJsonl(path.join(dir, 'documents.jsonl'));
  const L = await buildLookups(students, apps, comments);

  // ---- the plan
  const existing = await Students.find({ refrenceNo: { $in: students.map((s) => s.ref) } }, 'refrenceNo').lean();
  const missingFiles = docs.filter((d) => !d.localPath || !fs.existsSync(path.join(filesRoot, d.localPath)));
  const unknownUsers = [...new Set(students.flatMap((s) => (s.team || []).map((t) => t.email)))].filter(
    (e) => !L.userByEmail.has(e)
  );
  const unknownLevels = [...new Set(students.map((s) => s.preference.courseLevelName).filter(Boolean))].filter(
    (n) => !L.levelByName.has(n)
  );
  const unknownCountries = [...new Set(students.map((s) => s.nationalityName).filter(Boolean))].filter(
    (n) => !L.countryByName.has(n)
  );
  const unknownUnis = L.uniNames.filter((n) => !L.uniFor(n));
  const mb = docs.reduce((t, d) => t + (d.bytes || 0), 0) / 1e6;
  console.log('\nPlan');
  console.log(`  students      ${students.length}  (${existing.length} already imported, would be updated)`);
  console.log(`  applications  ${apps.length}`);
  console.log(`  comments      ${comments.length}`);
  console.log(`  notes         ${notes.length}`);
  console.log(`  activities    ${activities.length}`);
  console.log(
    `  documents     ${docs.length}  (${mb.toFixed(1)} MB${args['skip-files'] ? ', files skipped' : ''}; ${
      missingFiles.length
    } local files missing)`
  );
  console.log(`  file storage  ${BUCKET}/${PREFIX}…`);
  console.log('\nLookups');
  console.log(`  team users found:     ${[...L.userByEmail.keys()].length}  missing: ${unknownUsers.join(', ') || 'none'}`);
  console.log(
    `  course levels found:  ${[...L.levelByName.keys()].join(', ') || 'none'}  missing: ${
      unknownLevels.join(', ') || 'none'
    }`
  );
  console.log(`  countries missing:    ${unknownCountries.join(', ') || 'none'}`);
  console.log(
    `  universities matched: ${L.uniNames.length - unknownUnis.length}/${
      L.uniNames.length
    }  (unmatched keep their name, no logo: ${unknownUnis.join('; ') || 'none'})`
  );
  if (L.approx.size) {
    console.log('  near matches (check these):');
    L.approx.forEach((theirs, ours) => console.log(`    ${ours}  ->  ${theirs}`));
  }
  if (!write) {
    console.log(`\nDry run: nothing was written. To import, add --confirm=${dbName}`);
    return;
  }

  // ---- write
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const manifestFile = path.join(dir, `import-manifest-${stamp}.json`);
  const manifest = {
    database: dbName,
    startedAt: new Date().toISOString(),
    students: [],
    applications: [],
    comments: [],
    notes: [],
    activities: [],
    documents: [],
    files: [],
  };
  const saveManifest = () => fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 1));
  console.log(`\nWriting. Manifest: ${manifestFile}`);

  const urlByAtt = new Map();
  (await Documents.find({ 'blobInfo.trelloAttachmentId': { $in: docs.map((d) => d.ref) } }, 'blobInfo').lean()).forEach(
    (d) =>
      (d.blobInfo || []).forEach(
        (b) => b.blobUrl && b.trelloAttachmentId && urlByAtt.set(String(b.trelloAttachmentId).replace(/^TR-/, ''), b.blobUrl)
      )
  );
  for (const s of students) {
    const sDoc = studentDoc(s, L);
    const { id: studentId } = await upsert(
      Students,
      { refrenceNo: s.ref },
      { ...sDoc, applications: [] },
      manifest.students
    );
    saveManifest();

    const appIdByRef = new Map();
    for (const a of apps.filter((x) => x.studentRef === s.ref)) {
      const { id } = await upsert(
        Application,
        { applicationId: a.ref },
        applicationDoc(a, studentId, L),
        manifest.applications
      );
      appIdByRef.set(a.ref, id);
    }
    const currentApps = apps
      .filter((x) => x.studentRef === s.ref && x.journeyIndex === null)
      .map((x) => String(appIdByRef.get(x.ref)));
    const journeys = (s.journeys || []).map((j) => ({
      startedAt: date(j.startedAt),
      closedAt: date(j.closedAt),
      appliedAt: date(j.appliedAt),
      degree: j.degree || undefined,
      major: j.major || undefined,
      destination: j.destination,
      intakeMonth: j.intakeMonth || undefined,
      intakeYear: j.intakeYear || undefined,
      outcome: j.outcome,
      applications: (j.applicationRefs || []).map((r) => appIdByRef.get(r)).filter(Boolean),
      provider: j.provider || undefined,
      enrolledApplication: j.enrolledApplicationRef ? appIdByRef.get(j.enrolledApplicationRef) : undefined,
      enrolledUniversity: j.enrolledUniversity || undefined,
    }));
    await Students.updateOne({ _id: studentId }, { $set: { applications: currentApps, journeys } }, NO_TS);

    let uploaded = 0;
    for (const d of docs.filter((x) => x.studentRef === s.ref)) {
      let url = null;
      if (!args['skip-files'] && d.localPath && fs.existsSync(path.join(filesRoot, d.localPath))) {
        const r = await upload(path.join(filesRoot, d.localPath), d.storagePath, d.mimeType);
        url = r.url;
        if (r.uploaded) {
          manifest.files.push(d.storagePath);
          uploaded += 1;
        }
      }
      if (!url) {
        // no file this run (--skip-files, or not on this Mac yet): keep the URL an
        // earlier run already stored rather than blanking it
        const prev = await Documents.findOne({ studentId, 'blobInfo.trelloAttachmentId': d.ref }, { blobInfo: 1 }).lean();
        const b = prev && (prev.blobInfo || []).find((x) => x.trelloAttachmentId === d.ref);
        if (b && b.blobUrl) url = b.blobUrl;
      }
      if (url) urlByAtt.set(String(d.ref).replace(/^TR-/, ''), url);
      await upsert(
        Documents,
        { studentId, 'blobInfo.trelloAttachmentId': d.ref },
        {
          studentId,
          documentType: d.documentType,
          subType: d.subType,
          docTypeKey: d.docTypeKey,
          docState: d.docState,
          blobInfo: url
            ? [{ blobUrl: url, fileName: d.fileName, name: d.fileName, trelloAttachmentId: d.ref }]
            : [{ fileName: d.fileName, name: d.fileName, trelloAttachmentId: d.ref }],
          createdAt: date(d.createdAt),
          updatedAt: date(d.createdAt),
        },
        manifest.documents
      );
    }
    for (const c of comments.filter((x) => x.studentRef === s.ref)) {
      const u = c.userEmail && L.userByEmail.get(c.userEmail);
      const tagged = (c.taggedEmails || [])
        .map((e) => L.userByEmail.get(e))
        .filter(Boolean)
        .map((x) => x._id);
      await upsert(
        Comments,
        { studentId, dateTime: date(c.dateTime), createdBy: c.createdBy },
        {
          studentId,
          content: crmCommentContent(c, urlByAtt, L),
          dateTime: date(c.dateTime),
          createdBy: c.createdBy,
          ...(u ? { userId: u._id } : {}),
          taggedUsers: tagged,
          createdAt: date(c.dateTime),
          updatedAt: date(c.dateTime),
        },
        manifest.comments
      );
    }
    for (const n of notes.filter((x) => x.studentRef === s.ref)) {
      await upsert(
        Note,
        { student: studentId, createdAt: date(n.createdAt), authorName: n.authorName },
        {
          student: studentId,
          body: n.body,
          authorName: n.authorName,
          pinned: !!n.pinned,
          createdAt: date(n.createdAt),
          updatedAt: date(n.createdAt),
        },
        manifest.notes
      );
    }
    for (const a of activities.filter((x) => x.studentRef === s.ref)) {
      await upsert(
        Activity,
        { student: studentId, text: a.text, createdAt: date(a.createdAt) },
        {
          student: studentId,
          type: a.type,
          text: a.text,
          actorName: a.actorName,
          meta: a.meta,
          createdAt: date(a.createdAt),
          updatedAt: date(a.createdAt),
        },
        manifest.activities
      );
    }
    saveManifest();
    console.log(`  ✓ ${s.ref}  ${s.stage.padEnd(10)} apps ${appIdByRef.size}  files uploaded ${uploaded}`);
  }
  manifest.finishedAt = new Date().toISOString();
  saveManifest();
  console.log('\nDone. To undo exactly this run:');
  console.log(`  node scripts/import-trello.js --env=staging --rollback="${manifestFile}" --confirm=${dbName}`);
}

if (require.main === module) {
  main()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
}

module.exports = { studentDoc, applicationDoc, crmCommentContent };
