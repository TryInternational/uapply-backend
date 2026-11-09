/* eslint-disable no-console */
/**
 * One demo account per role, for a walkthrough.
 *
 * Creates a user for every role in the collection that does not already have a
 * demo account, so a demo can move between the back office, the sub-agent
 * portal and the school portal without editing the database by hand.
 *
 * WHAT IT DOES NOT DO
 * It does not invent a password. You pass one, it is used for every demo
 * account, and it is never written to a file or logged anywhere but your own
 * terminal. These are demo accounts on a staging database — do not run this
 * against production, and do not reuse a password you use anywhere real.
 *
 * Roles are matched BY NAME, never by id: the whole point of the roleRights
 * work is that ids can be recreated freely. A role that is not in the database
 * is skipped and reported, not guessed at.
 *
 *   node scripts/seed-demo-users.js --env=staging --password='Demo2026pass'
 *   node scripts/seed-demo-users.js --env=staging --password='Demo2026pass' --confirm=upply_staging
 *
 * Idempotent: an email that already exists is left exactly as it is.
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
if (!args.password || args.password === true) {
  console.error("Pass --password='...' — the shared password for the demo accounts.");
  console.error('At least 8 characters, with a letter and a digit (the User model enforces it).');
  process.exit(1);
}
process.env.APP_ENV = args.env;
process.env.NODE_ENV = process.env.NODE_ENV || 'development';

// eslint-disable-next-line import/no-dynamic-require
const config = require(path.join(__dirname, '..', 'src', 'config', 'config'));
const mongoose = require('mongoose');

const PASSWORD = String(args.password);

/**
 * A logo, generated rather than fetched.
 *
 * A monogram on a tinted rounded square, inlined as a data URI. Deliberately
 * not a URL to an image host: a demo should not depend on a third party being
 * reachable, and a broken image in front of a CEO is a bad five seconds. It is
 * also self-contained, so the database carries everything the card needs.
 *
 * These are MONOGRAMS, deliberately not the real organisations' logos. A
 * school's logo is its trademark, and reproducing one in seeded demo data is
 * not ours to do. The app has a logo upload on the partner card — dropping the
 * real file in takes about five seconds, and makes a better demo beat than a
 * logo that was simply there.
 */
const monogramLogo = (label, from, to) => {
  // An explicit acronym wins over derived initials: "ASK" is how the school is
  // known, where the first letters of the first two words give "AS".
  const initials = /^[A-Z]{2,4}$/.test(label)
    ? label
    : label
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0])
        .join('')
        .toUpperCase();
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">`,
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">`,
    `<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>`,
    `</linearGradient></defs>`,
    `<rect width="128" height="128" rx="28" fill="url(#g)"/>`,
    `<text x="64" y="64" font-family="Helvetica,Arial,sans-serif" font-size="46" font-weight="700"`,
    ` fill="#fff" text-anchor="middle" dominant-baseline="central">${initials}</text>`,
    `</svg>`,
  ].join('');
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
};

/**
 * The cast. Keyed on ROLE NAME as it appears in the roles collection.
 *
 * `organisation` matters for the two partner roles and only for them: the
 * portal nav and the partner directory card are titled with it, so a partner
 * created without one demos as a blank card. Partner emails sit on their OWN
 * domains, because an external partner with an @ulearnkw.com address would
 * quietly undermine the whole point of the partner portals.
 */
const CAST = [
  {
    roleName: 'Admin',
    name: 'Mohammad',
    email: 'mohammad@ulearnkw.com',
    blurb: 'Back office — sees everything, manages users, roles and SLA settings',
  },
  {
    roleName: 'Counselor',
    name: 'Zainab Fakhreddine',
    email: 'zainab@ulearnkw.com',
    blurb: 'Back office — her students, courses, fees, the partner review queue',
  },
  {
    roleName: 'Counselor',
    name: 'Farah Abu Shanab',
    email: 'farah@ulearnkw.com',
    blurb: 'Back office — top of the counsellor leaderboard in the demo data',
  },
  {
    roleName: 'Counselor',
    name: 'Noura Al-Sabah',
    email: 'noura@ulearnkw.com',
    blurb: 'Back office — second counsellor, for showing assignment and hand-off',
  },
  {
    roleName: 'Operation',
    name: 'Cassandra',
    email: 'cassandra@ulearnkw.com',
    blurb: 'Back office — visa, CAS and test bookings',
  },
  {
    roleName: 'Sub Agent',
    name: 'Khalid Al-Otaibi',
    email: 'khalid@gulfedupartners.invalid',
    organisation: 'Gulf Education Partners',
    logo: ['Gulf Education', '#5b46d9', '#8a6cff'],
    blurb: 'Sub-agent portal — submits students for Ulearn to review',
  },
  {
    roleName: 'School Counselor',
    name: 'Sara Boland',
    // A .invalid domain (RFC 2606) — it can never resolve, so no invite or
    // notification this system sends can reach a real inbox at a real school.
    // Swap it for the school's true domain only if you are certain nothing in
    // the demo triggers an email.
    email: 'sara.boland@ask.edu.invalid',
    organisation: 'American School of Kuwait',
    // A MONOGRAM, not the school's actual logo — see the note in the header.
    logo: ['ASK', '#123a6b', '#2f6fb5'],
    blurb: 'School portal — refers pupils and follows every offer as it lands',
  },
];

// Where each one signs in. Read from config so a demo on a deployed host gets
// the right URLs rather than localhost.
const portalFor = (roleName) => {
  if (roleName === 'Sub Agent') return `${config.appUrls.subAgentPortal}/sub-agent/login`;
  if (roleName === 'School Counselor') return `${config.appUrls.backoffice}/school/login`;
  return `${config.appUrls.backoffice}/`;
};

(async () => {
  await mongoose.connect(config.mongoose.url, config.mongoose.options || {});
  const db = mongoose.connection;
  const dbName = db.name;
  console.log(`\nconnected to: ${dbName}   (APP_ENV=${args.env})\n`);

  // The model, not the raw collection: the schema's pre-save hook is what
  // bcrypts the password. Inserting through the driver would store it in clear.
  // eslint-disable-next-line import/no-dynamic-require
  const { User, Roles } = require(path.join(__dirname, '..', 'src', 'models'));

  const roles = await Roles.find({}).select('name').lean();
  const roleByName = new Map(roles.map((r) => [String(r.name || '').toLowerCase(), r]));

  const plan = [];
  for (const person of CAST) {
    const role = roleByName.get(person.roleName.toLowerCase());
    const email = String(person.email).toLowerCase();
    // eslint-disable-next-line no-await-in-loop
    const existing = await User.findOne({ email });
    plan.push({ ...person, email, role, existing: !!existing });
  }

  console.log('role                 name                    email                          status');
  plan.forEach((p) => {
    // eslint-disable-next-line no-nested-ternary
    const status = !p.role ? 'NO SUCH ROLE — skipped' : p.existing ? 'already exists — left alone' : 'would create';
    console.log(`  ${p.roleName.padEnd(18)} ${p.name.padEnd(23)} ${p.email.padEnd(30)} ${status}`);
  });

  const missing = plan.filter((p) => !p.role);
  if (missing.length) {
    console.log(`\nRoles not found in this database: ${missing.map((m) => m.roleName).join(', ')}`);
    console.log('Nothing is guessed — create the role first, or drop it from the cast.');
  }

  const todo = plan.filter((p) => p.role && !p.existing);

  if (!args.confirm) {
    console.log(`\nNothing written — this was a dry run. ${todo.length} account(s) would be created.`);
    console.log(`To create them:  --env=${args.env} --password='...' --confirm=${dbName}\n`);
    await mongoose.disconnect();
    return;
  }
  if (args.confirm !== dbName) {
    console.error(`\nRefusing: you confirmed "${args.confirm}" but this is "${dbName}".\n`);
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log('');
  for (const p of todo) {
    // eslint-disable-next-line no-await-in-loop
    await User.create({
      name: p.name,
      email: p.email,
      password: PASSWORD,
      role: p.role._id,
      ...(p.organisation ? { organisation: p.organisation } : {}),
      ...(p.logo ? { organisationLogo: monogramLogo(p.logo[0], p.logo[1], p.logo[2]) } : {}),
    });
    console.log(`  created  ${p.email.padEnd(30)} ${p.roleName}`);
  }

  console.log('\n─── the demo cast ───────────────────────────────────────────────────');
  plan
    .filter((p) => p.role)
    .forEach((p) => {
      console.log(`\n  ${p.name}  ·  ${p.roleName}`);
      console.log(`    ${p.blurb}`);
      console.log(`    sign in: ${portalFor(p.roleName)}`);
      console.log(`    email:   ${p.email}`);
      if (p.organisation) console.log(`    org:     ${p.organisation}`);
    });
  console.log('\n  All of them share the password you passed on the command line.\n');

  await mongoose.disconnect();
})().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
