/* eslint-disable no-console */
/**
 * Kuwait's schools, for the School typeahead on the student profile.
 *
 * The schools collection (model `School`: english_name + countryName) feeds
 * `GET /school/search/:text`. On a fresh database it holds nothing, so every
 * counsellor has to type each school by hand and the same school ends up
 * spelled four ways. This seeds the schools students in Kuwait actually come
 * from: the private / international schools (American, British, bilingual,
 * IB, Indian, Pakistani, French) and the main government secondary schools.
 *
 *   node scripts/seed-kuwait-schools.js --env=staging
 *   node scripts/seed-kuwait-schools.js --env=production --confirm=<db name>
 *
 * Idempotent: a name already in the collection (case-insensitive, ignoring
 * punctuation) is left as it is — re-running only adds what is missing.
 * Edit the list below to add or correct a school; nothing else is needed.
 */
const path = require('path');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v === undefined ? true : v];
  })
);

if (!args.env) {
  console.error('Refusing to guess which database. Pass --env=staging');
  process.exit(1);
}
process.env.APP_ENV = args.env;
process.env.NODE_ENV = process.env.NODE_ENV || 'development';

// eslint-disable-next-line import/no-dynamic-require
const config = require(path.join(__dirname, '..', 'src', 'config', 'config'));
const mongoose = require('mongoose');
const School = require('../src/models/school.model');

const COUNTRY = 'Kuwait';

/** Private and international schools (secondary stage). */
const PRIVATE = [
  // American curriculum
  'American School of Kuwait (ASK)',
  'American International School Kuwait (AIS)',
  'American Creativity Academy (ACA)',
  'American Academy for Girls (AAG)',
  'American United School of Kuwait (AUS)',
  'American Baccalaureate School (ABS)',
  'Universal American School (UAS)',
  'Kuwait American School (KAS)',
  'Fawzia Sultan International School (FSIS)',
  'Al-Bayan Bilingual School (BBS)',
  "Al-Ru'ya Bilingual School (ARBS)",
  'Dasman Bilingual School (DBS)',
  'Hayat Universal Bilingual School (HUBS)',
  'Kuwait Bilingual School (KBS)',
  'Al-Ghanim Bilingual School',
  'Al-Nibras International Bilingual School',
  'Al-Jeel Al-Jadeed School (AJJ)',
  'Al-Rowad Bilingual School',
  'Al-Resala Bilingual School',
  'Ajial Bilingual School',
  'Boubyan Bilingual School',
  'Al-Mustaqbal Bilingual School',
  'Al-Tamayoz Bilingual School',
  'Al-Hekma Bilingual School',
  'Atakamul International School',
  // British curriculum
  'The British School of Kuwait (BSK)',
  'Kuwait English School (KES)',
  'The English School Kuwait (TES)',
  'New English School (NES)',
  'Kuwait National English School (KNES)',
  'Kuwait International English School (KIES)',
  'Gulf English School (GES)',
  'Gulf British Academy (GBA)',
  'The English Academy',
  'Cambridge English School Kuwait',
  'Al-Ahmadi English School',
  'Oxford English School Kuwait',
  // Indian curriculum (CBSE / ICSE)
  'Indian Community School Kuwait (ICSK)',
  'Carmel School Kuwait',
  'Indian English Academy School (Don Bosco)',
  'Bhavans Smart Indian School',
  'Indian Educational School (Bharatiya Vidya Bhavan)',
  'Indian Learners Own Academy (ILOA)',
  'United Indian School',
  'Fahaheel Al-Watanieh Indian Private School (FAIPS)',
  'Gulf Indian School',
  'Indian Central School',
  'Kuwait Indian School',
  'Jabriya Indian School (JIS)',
  'Al-Amal Indian School',
  'Integrated Indian School',
  'Salmiya Indian Model School',
  'Smart Indian School',
  // Pakistani curriculum
  'Pakistan International School Kuwait',
  'Pakistan English School Kuwait',
  'Pakistan International English School',
  // Other
  'Lycée Français de Koweït',
  'Philippine International School Kuwait',
  'Kuwait International School',
  'Al-Rayan Private School',
  'Al-Andalus Private School',
];

/** Government (Ministry of Education) secondary schools, by area. */
const PUBLIC = [
  'Abdullah Al-Salem Secondary School',
  'Shuwaikh Secondary School',
  'Kaifan Secondary School',
  'Khaldiya Secondary School',
  'Jabriya Secondary School',
  'Surra Secondary School',
  'Mishref Secondary School',
  'Bayan Secondary School',
  'Salwa Secondary School',
  'Rumaithiya Secondary School',
  'Salmiya Secondary School',
  'Hawalli Secondary School',
  'Al-Yarmouk Secondary School',
  'Al-Rabiya Secondary School',
  'Al-Qurain Secondary School',
  'Sabah Al-Salem Secondary School',
  'Al-Farwaniya Secondary School',
  'Al-Jahra Secondary School',
  'Al-Ahmadi Secondary School',
  'Al-Fintas Secondary School',
  'Al-Fahaheel Secondary School',
  'Al-Mangaf Secondary School',
  'Qurtuba Secondary School',
  'Al-Salam Secondary School',
  'Al-Shamiya Secondary School',
  'Al-Adailiya Secondary School',
  'Al-Rawda Secondary School',
  'Al-Daiya Secondary School',
  'Mubarak Al-Kabeer Secondary School',
  'Al-Omariya Secondary School',
  'Al-Riggae Secondary School',
  'Al-Sulaibikhat Secondary School',
  'Al-Doha Secondary School',
  'Jaber Al-Ahmad Secondary School',
  'Saad Al-Abdullah Secondary School',
  'Abu Halifa Secondary School',
  'Al-Wafra Secondary School',
];

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

async function main() {
  const { url } = config.mongoose;
  const dbName = (url.split('/').pop() || '').split('?')[0];
  if (args.env === 'production' && args.confirm !== dbName) {
    console.error(`Production run needs --confirm=${dbName}`);
    process.exit(1);
  }
  await mongoose.connect(url, config.mongoose.options);
  console.log(`Connected to ${dbName}`);

  const existing = await School.find({}, { english_name: 1 }).lean();
  const have = new Set(existing.map((s) => norm(s.english_name)));

  const wanted = [...PRIVATE, ...PUBLIC];
  const toAdd = [];
  const seen = new Set();
  wanted.forEach((name) => {
    const k = norm(name);
    if (!k || seen.has(k)) return;
    seen.add(k);
    if (!have.has(k)) toAdd.push({ english_name: name, countryName: COUNTRY });
  });

  if (toAdd.length) await School.insertMany(toAdd);
  console.log(
    `${toAdd.length} added, ${wanted.length - toAdd.length} already there (${existing.length} schools before, ${
      existing.length + toAdd.length
    } now).`
  );
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
