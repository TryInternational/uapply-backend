/* eslint-disable no-console, no-await-in-loop, no-restricted-syntax, no-continue, global-require, security/detect-non-literal-fs-filename */
/**
 * Logos for universities that were added without one.
 *
 *   node scripts/add-university-logos.js
 *       downloads each official logo / crest from Wikimedia Commons / Wikipedia,
 *       makes it a square PNG (macOS `sips`) in ~/Downloads/university-logos/
 *   ... --upload
 *       also copies them to gs://uapply/live/images/institutions/ (gsutil, your login)
 *   ... --confirm=<staging db name>
 *       also points the universities AND the applications that already carry a
 *       copy of the university (institute.logoUrl) at the new files, on STAGING.
 *
 * Nothing touches production. Run with all three: --upload --confirm=upply_staging
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.length ? v.join('=') : true];
  })
);

// [university name exactly as in the CRM, file on Wikimedia Commons / Wikipedia]
const LOGOS = [
  ["King's College London", 'Kcl-logo.svg'],
  ['University of Leeds', 'Coat of Arms of the University of Leeds.svg'],
  ['Edge Hill University', 'Edge Hill University logo.png'],
  ['La Trobe University', 'LTU_Armorial_CMYK_small.PNG'],
  ['Western Sydney University', 'Western Sydney University logo.png'],
  ['University of Adelaide', 'Arms of the University of Adelaide.svg'],
  ['Arizona State University', 'Arizona State University logo.svg'],
  ['Colorado State University', 'Colorado State University logo.svg'],
  ['George Mason University', 'George Mason University logo.svg'],
  ['Hofstra University', 'Hofstra University logo wide.svg'],
  ['Illinois State University', 'Illinois State University logo.svg'],
  ['Oregon State University', 'Oregon State University wordmark.svg'],
  ['University of Arizona', 'University of Arizona logo.svg'],
  ['University of Oklahoma', 'University_of_Oklahoma_seal.svg'],
  ['Curtin University', 'CurtinUni Logo.svg'],
  ['Edith Cowan University', 'Edith_Cowan_University_Coat_of_Arms.svg'],
  ['Griffith University', 'Griffith_University_Logo_Variant_2022.svg'],
  ['Murdoch University', 'Murdoch University extended logo.png'],
  ['University College Dublin', 'University_College_Dublin_logo.svg'],
  ['Goldsmiths, University of London', 'Goldsmithsnew.png'],
  ["Regent's University London", 'Regents_University_London_logo.svg'],
  ['University College London', 'UCL Crest.svg'],
  ['University of Aberdeen', 'Arms of the University of Aberdeen.svg'],
  ['University of Edinburgh', 'University of Edinburgh coat of arms.JPG'],
];
const UA = { 'User-Agent': 'UlearnCRM/1.0 (university logo import; contact: admin)' };
const slug = (s) =>
  s
    .toLowerCase()
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
const OUT = path.join(os.homedir(), 'Downloads', 'university-logos');
const PREFIX = 'live/images/institutions/';

async function fetchLogos() {
  fs.mkdirSync(OUT, { recursive: true });
  const done = [];
  for (const [name, file] of LOGOS) {
    const target = path.join(OUT, `${slug(name)}-logo.png`);
    if (fs.existsSync(target)) {
      done.push([name, target]);
      continue;
    }
    const api = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url&iiurlwidth=600&titles=${encodeURIComponent(
      `File:${file}`
    )}`;
    const info = await (await fetch(api, { headers: UA })).json();
    const page = Object.values(info.query.pages)[0];
    const url = page.imageinfo && (page.imageinfo[0].thumburl || page.imageinfo[0].url);
    if (!url) {
      console.log(`  ✗ ${name}: no image found`);
      continue;
    }
    const res = await fetch(url, { headers: UA });
    if (!res.ok) {
      console.log(`  ✗ ${name}: download failed (${res.status})`);
      continue;
    }
    const raw = path.join(OUT, `.${slug(name)}.download`);
    fs.writeFileSync(raw, Buffer.from(await res.arrayBuffer()));
    // square, white padding, like the existing logos (macOS sips)
    const fitted = path.join(OUT, `.${slug(name)}.fit.png`);
    execFileSync('sips', ['-s', 'format', 'png', '-Z', '480', raw, '--out', fitted], { stdio: 'ignore' });
    execFileSync('sips', ['--padToHeightWidth', '560', '560', '--padColor', 'FFFFFF', fitted, '--out', target], {
      stdio: 'ignore',
    });
    fs.rmSync(raw, { force: true });
    fs.rmSync(fitted, { force: true });
    console.log(`  ✓ ${name}`);
    done.push([name, target]);
    await new Promise((r) => {
      setTimeout(r, 300);
    });
  }
  console.log(`\n${done.length}/${LOGOS.length} logos ready in ${OUT}`);
  return done;
}

async function main() {
  console.log('Logos:');
  const done = await fetchLogos();

  if (args.upload) {
    console.log(`\nUploading to gs://uapply/${PREFIX} …`);
    execFileSync(
      'gsutil',
      ['-m', '-h', 'Cache-Control:public, max-age=86400', 'cp', ...done.map(([, f]) => f), `gs://uapply/${PREFIX}`],
      { stdio: 'inherit' }
    );
  }

  if (args.confirm) {
    process.env.APP_ENV = 'staging';
    process.env.NODE_ENV = process.env.NODE_ENV || 'development';
    // eslint-disable-next-line import/no-dynamic-require
    const config = require(path.join(__dirname, '..', 'src', 'config', 'config'));
    const mongoose = require('mongoose');
    await mongoose.connect(config.mongoose.url, config.mongoose.options);
    const db = mongoose.connection;
    if (args.confirm !== db.name) {
      console.error(`--confirm=${args.confirm} does not match the staging database "${db.name}". Nothing written.`);
      await mongoose.disconnect();
      process.exit(1);
    }
    console.log(`\nUpdating "${db.name}":`);
    for (const [name] of done) {
      const logoUrl = `${PREFIX}${slug(name)}-logo.png`;
      const u = await db
        .collection('universities')
        .updateMany(
          { name, $or: [{ logoUrl: { $exists: false } }, { logoUrl: '' }, { logoUrl: null }] },
          { $set: { logoUrl } }
        );
      const a = await db.collection('applications').updateMany(
        {
          'institute.name': name,
          $or: [{ 'institute.logoUrl': { $exists: false } }, { 'institute.logoUrl': '' }, { 'institute.logoUrl': null }],
        },
        { $set: { 'institute.logoUrl': logoUrl } }
      );
      console.log(`  ${name.padEnd(34)} university ${u.modifiedCount}  applications ${a.modifiedCount}`);
    }
    await mongoose.disconnect();
  }
  if (!args.upload || !args.confirm)
    console.log('\nAdd --upload --confirm=upply_staging to upload them and show them in the staging CRM.');
}

main().catch((e) => {
  console.error(e.message || e);
  process.exitCode = 1;
});
