/* eslint-disable no-console, no-await-in-loop, no-restricted-syntax, no-continue, security/detect-non-literal-fs-filename, security/detect-object-injection */
/**
 * Copy the `fees` collection from PRODUCTION to STAGING, linking every fee it
 * can to a staging student and to the staging staff member it refers to.
 *
 * Why: the dashboards and the student "Payments & services" card read fees.
 * Staging's students came from the Trello import with new ids, so prod's
 * `student` pointers (and the staff ids inside `tag`) mean nothing there until
 * they are mapped. NOTHING IS DROPPED: a fee whose student cannot be matched
 * is still copied (so totals, sales and school cards match production) — it
 * just lands unlinked and goes on the worklist in the report.
 *
 * Production is only READ. Staging is written only with --confirm.
 *
 *   node scripts/migrate-fees-from-production.js
 *       dry run: matches everything, prints the summary, writes the reports.
 *       Writes nothing to either database.
 *   ... --confirm=<staging db name>
 *       inserts the fees (same _id as production) and writes a manifest.
 *   ... --relink [--confirm=<staging db name>]
 *       re-runs ONLY the student matching on staging fees that have no
 *       `student` yet (after you fixed a name or a phone), no inserts.
 *   ... --rollback=<manifest> --confirm=<staging db name>
 *       removes exactly the fees that run inserted (or undoes a relink).
 *   ... --require-staff
 *       skip fees whose staff member has no counterpart in staging (default:
 *       copy them anyway and list the missing staff).
 *   ... --limit=500
 *       first N production fees only (a quick rehearsal).
 *
 * Student matching: name OR phone. Names are lowercased, stripped of
 * punctuation and diacritics, compared with and without the middle name;
 * phones are compared on their national digits (dial code, 00 and leading
 * zeros removed; one may be a suffix of the other when 8+ digits are shared).
 * A student matching on BOTH wins a tie; otherwise exactly one candidate is
 * required — zero → unlinked (noMatch), several → unlinked (ambiguous, the
 * candidates are in the report). A fee with no `student` pointer uses the
 * name and phone the receipt itself carries (tag.fullName / tag.phoneNo).
 *
 * Staff mapping (tag.salesPerson, tag.incharge, tag.checkedBy,
 * tag.accountManager, tag.operation — id strings, or whole user objects on
 * English self-funded rows): same _id in staging → kept; else same email;
 * else unique name; else left as it was and reported.
 */
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const mongoose = require('mongoose');

const { ObjectId } = mongoose.Types;

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.length ? v.join('=') : true];
  })
);
const root = path.join(__dirname, '..');
const envOf = (name) => {
  const file = path.join(root, `.env.${name}`);
  if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);
  const url = dotenv.parse(fs.readFileSync(file)).MONGODB_URL;
  if (!url) throw new Error(`MONGODB_URL is not set in .env.${name}`);
  return url;
};

const STAFF_FIELDS = ['salesPerson', 'incharge', 'checkedBy', 'accountManager', 'operation'];
const BATCH = 500;
const OUT_DIR = path.join(root, 'node_modules', '.cache', 'claude', 'fees-migration');

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/** Lowercase, no diacritics (Latin and Arabic marks), no punctuation, single spaces. */
const normName = (s) =>
  String(s || '')
    .normalize('NFKD')
    .replace(/[̀-ًͯ-ْٰ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');

/** "first last" when the name has three or more words; the name itself otherwise. */
const shortName = (n) => {
  const parts = n.split(' ').filter(Boolean);
  return parts.length >= 3 ? `${parts[0]} ${parts[parts.length - 1]}` : n;
};

// Dial codes seen in this CRM's numbers, longest first so 971 beats 97.
const DIAL_CODES = [
  '880',
  '965',
  '966',
  '968',
  '971',
  '973',
  '974',
  '962',
  '961',
  '234',
  '254',
  '212',
  '20',
  '91',
  '92',
  '44',
  '90',
  '60',
  '63',
  '1',
];

/** National digits: strip spaces, 00, leading zeros and a dial code. Empty when fewer than 7 digits. */
const normPhone = (s) => {
  let d = String(s || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  d = d.replace(/^0+/, '');
  // Only a number long enough to hold a dial code AND a full national number
  // loses its prefix — "9123456789" is an Indian mobile, not 91 + 23456789.
  if (d.length >= 11) {
    for (const code of DIAL_CODES) {
      if (d.startsWith(code) && d.length - code.length >= 8) {
        d = d.slice(code.length);
        break;
      }
    }
  }
  d = d.replace(/^0+/, '');
  return d.length >= 7 ? d : '';
};
/** Index key for a phone: its last 8 digits. */
const phoneKey = (d) => (d.length >= 8 ? d.slice(-8) : d);
/** Two national numbers are the same person when one ends with the other and they share 8+ digits. */
const samePhone = (a, b) => {
  if (!a || !b) return false;
  if (a === b) return true;
  const [s, l] = a.length < b.length ? [a, b] : [b, a];
  return s.length >= 8 && l.endsWith(s);
};

const isOid = (v) => Boolean(v) && typeof v === 'object' && typeof v.toHexString === 'function';
const idOf = (v) => {
  if (!v) return null;
  if (isOid(v)) return v.toHexString();
  if (typeof v === 'string') return /^[0-9a-f]{24}$/i.test(v) ? v : null;
  if (typeof v === 'object') return idOf(v.id || v._id);
  return null;
};
const fullNameOf = (s) => [s.firstName, s.middleName, s.lastName].filter(Boolean).join(' ');

const csvCell = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
const csv = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\n');
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

// ---------------------------------------------------------------------------
// Student index (staging)
// ---------------------------------------------------------------------------

const buildStudentIndex = (students) => {
  const byFull = new Map(); // exact normalised full name
  const byShort = new Map(); // first + last only (Kuwaiti names carry many middle initials)
  const byPhone = new Map();
  const info = new Map();
  const add = (map, key, id) => {
    if (!key) return;
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(id);
  };
  for (const s of students) {
    const id = String(s._id);
    const full = normName(fullNameOf(s));
    const short = shortName(full);
    const phone = normPhone(s.phoneNo);
    info.set(id, { name: fullNameOf(s), phone: s.phoneNo || '', nphone: phone, ref: s.refrenceNo || '' });
    add(byFull, full, id);
    add(byShort, short, id);
    if (phone) add(byPhone, phoneKey(phone), id);
  }
  return { byFull, byShort, byPhone, info };
};

/**
 * Match one person (name + phone as recorded in prod) against staging.
 * Returns { id } | { reason: 'noMatch' } | { reason: 'ambiguous', candidates }.
 */
const matchStudent = (index, name, phone) => {
  const n = normName(name);
  const nShort = shortName(n);
  const p = normPhone(phone);
  // Exact full name, or the fee's name equals a student's first+last (and
  // vice versa) — the second set is wider and only consulted as a fallback.
  const fullHits = new Set(index.byFull.get(n) || []);
  const nameHits = new Set([
    ...fullHits,
    ...(index.byShort.get(n) || []),
    ...(index.byFull.get(nShort) || []),
    ...(index.byShort.get(nShort) || []),
  ]);
  const phoneHits = new Set();
  if (p) {
    for (const id of index.byPhone.get(phoneKey(p)) || []) {
      if (samePhone(p, index.info.get(id).nphone)) phoneHits.add(id);
    }
  }
  const both = [...nameHits].filter((id) => phoneHits.has(id));
  if (both.length === 1) return { id: both[0], how: 'name+phone' };
  // One student with exactly this full name beats several who share first+last.
  if (fullHits.size === 1 && (phoneHits.size === 0 || [...phoneHits].every((id) => fullHits.has(id)))) {
    const [id] = fullHits;
    return { id, how: 'name' };
  }
  const union = new Set([...nameHits, ...phoneHits]);
  if (union.size === 1) {
    const [id] = union;
    return { id, how: nameHits.has(id) ? 'name' : 'phone' };
  }
  if (union.size === 0) return { reason: 'noMatch' };
  return {
    reason: 'ambiguous',
    candidates: [...union].map((id) => {
      const i = index.info.get(id);
      return `${i.name} (${i.phone || 'no phone'}${i.ref ? `, ${i.ref}` : ''})`;
    }),
  };
};

// ---------------------------------------------------------------------------
// Staff map (prod user → staging user)
// ---------------------------------------------------------------------------

const buildStaffMap = (prodUsers, stagingUsers) => {
  const sById = new Map(stagingUsers.map((u) => [String(u._id), u]));
  const sByEmail = new Map();
  const sByName = new Map();
  for (const u of stagingUsers) {
    if (u.email) sByEmail.set(String(u.email).toLowerCase(), u);
    const n = normName(u.name);
    if (!n) continue;
    if (!sByName.has(n)) sByName.set(n, []);
    sByName.get(n).push(u);
  }
  const map = new Map(); // prod id → { to, how, prodName, prodEmail, toName }
  for (const u of prodUsers) {
    const pid = String(u._id);
    let hit = null;
    let how = '';
    if (sById.has(pid)) {
      hit = sById.get(pid);
      how = 'same id';
    } else if (u.email && sByEmail.has(String(u.email).toLowerCase())) {
      hit = sByEmail.get(String(u.email).toLowerCase());
      how = 'email';
    } else {
      const list = sByName.get(normName(u.name)) || [];
      if (list.length === 1) {
        [hit] = list;
        how = 'name';
      }
    }
    map.set(pid, {
      to: hit ? String(hit._id) : null,
      how,
      prodName: u.name || '',
      prodEmail: u.email || '',
      toName: hit ? hit.name : '',
    });
  }
  return map;
};

/** Rewrite one staff reference (id string or user object) through the map. Returns [newValue, status]. */
const remapStaff = (value, staffMap, missing) => {
  const pid = idOf(value);
  if (!pid) return [value, 'none'];
  const m = staffMap.get(pid);
  if (!m || !m.to) {
    missing.set(pid, (missing.get(pid) || 0) + 1);
    return [value, 'unmapped'];
  }
  if (typeof value === 'string' || isOid(value)) return [m.to, m.how];
  const next = { ...value };
  if (next.id !== undefined) next.id = m.to;
  if (next._id !== undefined) next._id = m.to;
  return [next, m.how];
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const prodUrl = envOf('production');
  const stagingUrl = envOf('staging');
  if (prodUrl === stagingUrl) throw new Error('.env.production and .env.staging point at the same database. Stopping.');

  const prod = await mongoose.createConnection(prodUrl, { readPreference: 'secondaryPreferred' }).asPromise();
  const staging = await mongoose.createConnection(stagingUrl).asPromise();
  console.log(`Production (read only): "${prod.name}"   Staging (write): "${staging.name}"`);
  if (prod.name === staging.name) throw new Error('Both connections reached the same database name. Stopping.');
  if (args.confirm && args.confirm !== staging.name) {
    throw new Error(`--confirm=${args.confirm} does not match the staging database "${staging.name}". Nothing written.`);
  }
  const write = args.confirm === staging.name;
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const when = stamp();

  const pFees = prod.collection('fees');
  const pStudents = prod.collection('students');
  const pUsers = prod.collection('users');
  const sFees = staging.collection('fees');
  const sStudents = staging.collection('students');
  const sUsers = staging.collection('users');

  // ---- rollback -------------------------------------------------------------
  if (args.rollback) {
    const m = JSON.parse(fs.readFileSync(args.rollback, 'utf8'));
    if (m.database !== staging.name) throw new Error(`Manifest is for "${m.database}", not "${staging.name}".`);
    if (m.kind === 'relink') {
      console.log(`Undoing relink of ${m.relinked.length} fees…`);
      if (write) {
        for (const r of m.relinked) {
          await sFees.updateOne(
            { _id: new ObjectId(r.id) },
            r.before ? { $set: { student: new ObjectId(r.before) } } : { $unset: { student: '' } }
          );
        }
        console.log('Done.');
      } else console.log(`Dry run. Add --confirm=${staging.name} to undo.`);
    } else {
      const ids = m.inserted.map((id) => new ObjectId(id));
      console.log(`Removing ${ids.length} fees inserted on ${m.at}…`);
      if (write) {
        const r = await sFees.deleteMany({ _id: { $in: ids } });
        console.log(`Removed ${r.deletedCount}.`);
      } else console.log(`Dry run. Add --confirm=${staging.name} to remove them.`);
    }
    await Promise.all([prod.close(), staging.close()]);
    return;
  }

  // ---- staging lookups, loaded once ----------------------------------------
  console.log('Loading staging students and users…');
  const stagingStudents = await sStudents
    .find({}, { projection: { firstName: 1, middleName: 1, lastName: 1, phoneNo: 1, refrenceNo: 1 } })
    .toArray();
  const index = buildStudentIndex(stagingStudents);
  const stagingUsers = await sUsers.find({}, { projection: { name: 1, email: 1 } }).toArray();
  console.log(`  ${stagingStudents.length} students (${index.byPhone.size} distinct phones), ${stagingUsers.length} users`);

  // ---- relink mode -----------------------------------------------------------
  if (args.relink) {
    const unlinked = await sFees.find({ $or: [{ student: { $exists: false } }, { student: null }] }).toArray();
    console.log(`Relink: ${unlinked.length} staging fees without a student.`);
    const relinked = [];
    const rows = [['fee id', 'type', 'name', 'phone', 'result', 'candidates']];
    let linked = 0;
    let noMatch = 0;
    let ambiguous = 0;
    for (const f of unlinked) {
      const t = f.tag || {};
      let name = t.fullName || t.studentName || '';
      let phone = t.phoneNo || '';
      // When the fee came from prod with a student pointer, prefer that student's details.
      const prodSid = t.migration && t.migration.prodStudent;
      if (prodSid && ObjectId.isValid(prodSid)) {
        const ps = await pStudents.findOne(
          { _id: new ObjectId(prodSid) },
          { projection: { firstName: 1, middleName: 1, lastName: 1, phoneNo: 1 } }
        );
        if (ps) {
          name = fullNameOf(ps) || name;
          phone = ps.phoneNo || phone;
        }
      }
      if (!name && !phone) continue;
      const m = matchStudent(index, name, phone);
      if (m.id) {
        linked += 1;
        relinked.push({ id: String(f._id), before: f.student ? String(f.student) : null });
        if (write) {
          await sFees.updateOne(
            { _id: f._id },
            {
              $set: {
                student: new ObjectId(m.id),
                'tag.student': m.id,
                'tag.migration.link': 'linked',
                'tag.migration.linkedBy': m.how,
                'tag.migration.relinkedAt': new Date().toISOString(),
              },
            }
          );
        }
        rows.push([String(f._id), f.feeType, name, phone, `linked (${m.how})`, index.info.get(m.id).name]);
      } else {
        if (m.reason === 'noMatch') noMatch += 1;
        else ambiguous += 1;
        rows.push([String(f._id), f.feeType, name, phone, m.reason, (m.candidates || []).join(' | ')]);
      }
    }
    const report = path.join(OUT_DIR, `relink-${when}.csv`);
    fs.writeFileSync(report, csv(rows));
    console.log(
      `\nRelink ${write ? 'done' : '(dry run)'}: ${linked} linked · ${noMatch} still no match · ${ambiguous} ambiguous`
    );
    console.log(`Report: ${report}`);
    if (write && relinked.length) {
      const manifest = path.join(OUT_DIR, `relink-manifest-${when}.json`);
      fs.writeFileSync(
        manifest,
        JSON.stringify({ kind: 'relink', database: staging.name, at: new Date().toISOString(), relinked }, null, 2)
      );
      console.log(
        `To undo: node scripts/migrate-fees-from-production.js --rollback="${manifest}" --confirm=${staging.name}`
      );
    }
    await Promise.all([prod.close(), staging.close()]);
    return;
  }

  // ---- read production -------------------------------------------------------
  const limit = args.limit ? parseInt(args.limit, 10) : 0;
  const total = limit ? Math.min(limit, await pFees.countDocuments()) : await pFees.countDocuments();
  console.log(`Production fees: ${total}${limit ? ` (limited to ${limit})` : ''}`);
  const existing = new Set((await sFees.find({}, { projection: { _id: 1 } }).toArray()).map((f) => String(f._id)));
  console.log(`Staging already holds ${existing.size} fees (same _id → skipped as duplicate).`);

  // Pass 1: collect the referenced prod students and staff.
  const studentIds = new Set();
  const staffIds = new Set();
  let cursor = pFees.find({}, { projection: { student: 1, tag: 1 } }).sort({ _id: 1 });
  if (limit) cursor = cursor.limit(limit);
  for await (const f of cursor) {
    const sid = idOf(f.student) || idOf(f.tag && f.tag.student);
    if (sid) studentIds.add(sid);
    for (const k of STAFF_FIELDS) {
      const uid = idOf(f.tag && f.tag[k]);
      if (uid) staffIds.add(uid);
    }
  }
  const prodStudents = new Map();
  const allStudentIds = [...studentIds];
  for (let i = 0; i < allStudentIds.length; i += 1000) {
    const chunk = allStudentIds.slice(i, i + 1000);
    const docs = await pStudents
      .find(
        { _id: { $in: chunk.map((id) => new ObjectId(id)) } },
        { projection: { firstName: 1, middleName: 1, lastName: 1, phoneNo: 1 } }
      )
      .toArray();
    docs.forEach((d) => prodStudents.set(String(d._id), d));
  }
  const prodUsers = staffIds.size
    ? await pUsers
        .find({ _id: { $in: [...staffIds].map((id) => new ObjectId(id)) } }, { projection: { name: 1, email: 1 } })
        .toArray()
    : [];
  const staffMap = buildStaffMap(prodUsers, stagingUsers);
  console.log(
    `Referenced: ${studentIds.size} prod students (${prodStudents.size} still exist), ${staffIds.size} staff ids (${
      [...staffMap.values()].filter((m) => m.to).length
    } map to staging)`
  );

  // Pass 2: build the staging documents.
  const counts = {
    total: 0,
    duplicate: 0,
    inserted: 0,
    linked: 0,
    linkedBy: { 'name+phone': 0, name: 0, phone: 0 },
    noMatch: 0,
    ambiguous: 0,
    noIdentity: 0,
    studentMissingInProd: 0,
    skippedStaff: 0,
  };
  const unlinkedRows = [
    ['fee id', 'type', 'created', 'amount', 'name', 'phone', 'source of identity', 'result', 'candidates'],
  ];
  const missingStaff = new Map();
  const toInsert = [];
  const inserted = [];

  const flush = async () => {
    if (!toInsert.length) return;
    if (write) {
      const r = await sFees.insertMany(toInsert, { ordered: false });
      inserted.push(...Object.values(r.insertedIds).map(String));
    }
    counts.inserted += toInsert.length;
    toInsert.length = 0;
  };

  cursor = pFees.find({}).sort({ _id: 1 });
  if (limit) cursor = cursor.limit(limit);
  for await (const fee of cursor) {
    counts.total += 1;
    if (existing.has(String(fee._id))) {
      counts.duplicate += 1;
      continue;
    }
    const tag = { ...(fee.tag || {}) };

    // -- who is the student? prod pointer first, else what the receipt says
    const prodSid = idOf(fee.student) || idOf(tag.student);
    let name = '';
    let phone = '';
    let source = '';
    if (prodSid) {
      const ps = prodStudents.get(prodSid);
      if (ps) {
        name = fullNameOf(ps);
        phone = ps.phoneNo || '';
        source = 'prod student';
      } else {
        counts.studentMissingInProd += 1;
      }
    }
    if (!name && !phone) {
      name = tag.fullName || tag.studentName || '';
      phone = tag.phoneNo || '';
      source = name || phone ? 'receipt (tag)' : '';
    }
    // Prefer the receipt's own phone when the prod student had none.
    if (!phone && tag.phoneNo) phone = tag.phoneNo;

    let link = 'noIdentity';
    let candidates = [];
    let how = '';
    let stagingSid = null;
    if (name || phone) {
      const m = matchStudent(index, name, phone);
      if (m.id) {
        stagingSid = m.id;
        link = 'linked';
        how = m.how;
      } else {
        link = m.reason;
        candidates = m.candidates || [];
      }
    }
    counts[link === 'linked' ? 'linked' : link] += 1;
    if (link === 'linked') counts.linkedBy[how] += 1;
    else
      unlinkedRows.push([
        String(fee._id),
        fee.feeType,
        fee.createdDate ? new Date(fee.createdDate).toISOString().slice(0, 10) : '',
        tag.amount != null ? tag.amount : '',
        name,
        phone,
        source,
        link,
        candidates.join(' | '),
      ]);

    // -- staff
    let staffUnmapped = false;
    for (const k of STAFF_FIELDS) {
      if (tag[k] === undefined || tag[k] === null || tag[k] === '') continue;
      const [next, status] = remapStaff(tag[k], staffMap, missingStaff);
      tag[k] = next;
      if (status === 'unmapped') staffUnmapped = true;
    }
    if (staffUnmapped && args['require-staff']) {
      counts.skippedStaff += 1;
      continue;
    }

    // -- the document for staging: everything verbatim, pointers rewritten
    const doc = { ...fee, tag };
    if (stagingSid) {
      doc.student = new ObjectId(stagingSid);
      if (tag.student !== undefined) tag.student = stagingSid;
    } else {
      delete doc.student; // a prod id means nothing here
      if (tag.student !== undefined) delete tag.student;
    }
    tag.migration = {
      from: 'production',
      at: new Date().toISOString(),
      prodStudent: prodSid || null,
      link,
      linkedBy: how || null,
    };

    toInsert.push(doc);
    if (toInsert.length >= BATCH) await flush();
    if (counts.total % 1000 === 0) console.log(`  …${counts.total}/${total}`);
  }
  await flush();

  // ---- reports -----------------------------------------------------------------
  const unlinkedFile = path.join(OUT_DIR, `fees-unlinked-${when}.csv`);
  fs.writeFileSync(unlinkedFile, csv(unlinkedRows));
  const staffRows = [
    ['prod user id', 'prod name', 'prod email', 'matched by', 'staging user id', 'staging name', 'fees affected'],
  ];
  for (const [pid, m] of staffMap) {
    staffRows.push([
      pid,
      m.prodName,
      m.prodEmail,
      m.to ? m.how : 'UNMAPPED',
      m.to || '',
      m.toName,
      missingStaff.get(pid) || '',
    ]);
  }
  const staffFile = path.join(OUT_DIR, `staff-map-${when}.csv`);
  fs.writeFileSync(staffFile, csv(staffRows));

  const unlinked = counts.noMatch + counts.ambiguous + counts.noIdentity;
  console.log(`
${write ? 'MIGRATED' : 'DRY RUN — nothing written'}
  production fees seen        ${counts.total}
  already in staging (skip)   ${counts.duplicate}
  ${write ? 'inserted' : 'would insert'}                ${counts.inserted}${
    counts.skippedStaff ? `   (skipped for unmapped staff: ${counts.skippedStaff})` : ''
  }
    linked to a student       ${counts.linked}   (name+phone ${counts.linkedBy['name+phone']} · name ${
    counts.linkedBy.name
  } · phone ${counts.linkedBy.phone})
    unlinked                  ${unlinked}   (no match ${counts.noMatch} · ambiguous ${
    counts.ambiguous
  } · no name/phone on the fee ${counts.noIdentity})
    prod student deleted      ${counts.studentMissingInProd}   (matched from the receipt's own name/phone where possible)
  staff: ${staffMap.size} referenced · ${[...staffMap.values()].filter((m) => m.to).length} mapped · ${
    missingStaff.size
  } unmapped (fees affected: ${[...missingStaff.values()].reduce((a, b) => a + b, 0)})

Reports
  unlinked fees (the worklist)  ${unlinkedFile}
  staff mapping                 ${staffFile}`);

  if (write) {
    const manifest = path.join(OUT_DIR, `manifest-${when}.json`);
    fs.writeFileSync(
      manifest,
      JSON.stringify({ kind: 'insert', database: staging.name, at: new Date().toISOString(), inserted }, null, 2)
    );
    console.log(
      `  manifest                      ${manifest}\n\nTo undo: node scripts/migrate-fees-from-production.js --rollback="${manifest}" --confirm=${staging.name}`
    );
    console.log(
      `To link more later (after fixing names/phones): node scripts/migrate-fees-from-production.js --relink --confirm=${staging.name}`
    );
  } else {
    console.log(`\nTo run it for real: node scripts/migrate-fees-from-production.js --confirm=${staging.name}`);
  }

  await Promise.all([prod.close(), staging.close()]);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
