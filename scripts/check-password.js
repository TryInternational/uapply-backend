/* eslint-disable no-console */
/**
 * Why is this login failing?
 *
 * /auth/login answers "Incorrect email or password" for both causes on
 * purpose — telling a stranger which half was right is how an account list
 * gets enumerated. Locally that same message is just unhelpful, so this splits
 * the two apart, against the real user document and the real bcrypt compare.
 *
 *   node scripts/check-password.js --env=staging --email=someone@x.com --password='...'
 *
 * Add --set to REPLACE the password with the one given (dry run otherwise):
 *
 *   node scripts/check-password.js --env=staging --email=someone@x.com --password='NewOne2026' --set
 */
const path = require('path');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v === undefined ? true : v];
  })
);

if (!args.env || !args.email || !args.password || args.password === true) {
  console.error("Usage: --env=staging --email=someone@x.com --password='...' [--set]");
  process.exit(1);
}
process.env.APP_ENV = args.env;
process.env.NODE_ENV = process.env.NODE_ENV || 'development';

// eslint-disable-next-line import/no-dynamic-require
const config = require(path.join(__dirname, '..', 'src', 'config', 'config'));
const mongoose = require('mongoose');

const RAW = String(args.email);
const EMAIL = RAW.trim().toLowerCase();

(async () => {
  await mongoose.connect(config.mongoose.url, config.mongoose.options || {});
  console.log(`\ndatabase: ${mongoose.connection.name}\n`);
  // eslint-disable-next-line import/no-dynamic-require
  const { User, Roles } = require(path.join(__dirname, '..', 'src', 'models'));

  // Exactly what the login path does: findOne({ email }) with NO normalising.
  const asTyped = await User.findOne({ email: RAW });
  const asLower = await User.findOne({ email: EMAIL });
  const user = asTyped || asLower;

  if (!user) {
    console.log(`No user matches "${RAW}".`);
    const near = await User.find({ email: new RegExp(RAW.split('@')[0], 'i') })
      .select('email')
      .lean();
    if (near.length) {
      console.log('\nSimilar addresses that DO exist:');
      near.forEach((u) => console.log(`  ${u.email}`));
    } else {
      const all = await User.find({}).select('email').lean();
      console.log(`\nThe ${all.length} account(s) that exist:`);
      all.forEach((u) => console.log(`  ${u.email}`));
    }
    await mongoose.disconnect();
    process.exit(1);
  }

  if (!asTyped && asLower) {
    console.log(`NOTE: stored as "${user.email}" but you typed "${RAW}".`);
    console.log('getUserByEmail does findOne({ email }) without lowercasing, so the');
    console.log('case you type has to match what is stored.\n');
  }

  const role = await Roles.findById(user.role).select('name roleRights').lean();
  console.log(`user:     ${user.email}`);
  console.log(`name:     ${user.name}`);
  console.log(`role:     ${role ? role.name : '(no role document)'}`);
  if (user.organisation) console.log(`org:      ${user.organisation}`);
  console.log(
    `password: ${
      user.password
        ? `stored (${user.password.length} chars, ${user.password.startsWith('$2') ? 'bcrypt' : 'NOT HASHED — problem'})`
        : 'MISSING'
    }`
  );

  const matches = await user.isPasswordMatch(String(args.password));
  console.log(`\nthe password you passed ${matches ? 'MATCHES — this login should work' : 'does NOT match'}\n`);

  if (matches || !args.set) {
    if (!matches && !args.set) {
      console.log('To set it to the password you passed, re-run with --set\n');
    }
    await mongoose.disconnect();
    return;
  }

  // Through the model, so the pre-save hook bcrypts it. Assigning straight to
  // the collection would store the new password in clear text.
  user.password = String(args.password);
  await user.save();
  const now = await User.findOne({ email: user.email });
  console.log(`password reset — verify: ${(await now.isPasswordMatch(String(args.password))) ? 'OK' : 'FAILED'}\n`);

  await mongoose.disconnect();
})().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
