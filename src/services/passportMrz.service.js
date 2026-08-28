/* eslint-disable no-bitwise */
/**
 * Passport MRZ extraction.
 *
 * WHY MRZ AND NOT GENERAL OCR
 * ---------------------------
 * The machine-readable zone at the foot of a passport is a fixed-width format
 * with check digits on every field. That means a value either validates or it
 * does not — we never have to guess. General OCR of the printed visual zone has
 * no such guarantee, which is why only the MRZ-backed fields are returned as
 * confident here.
 *
 * WHAT THE MRZ DOES AND DOES NOT CONTAIN (TD3 / passport booklet)
 *   in  : passport number, nationality, date of birth, date of expiry, sex,
 *         and an optional "personal number" field that many issuers (Kuwait
 *         among them) populate with the civil / national id.
 *   NOT : date of issue, place of issue, place of birth.
 * Those three exist only in the printed zone. They are returned as null and the
 * caller must collect them by hand — inventing them would be worse than blank.
 *
 * PII
 * ---
 * The image is written to a temp file, read by the OCR process, and deleted in
 * a finally block. Nothing is persisted and nothing leaves this server.
 *
 * DEPENDENCIES
 * ------------
 * None added. Parsing is plain JS below; text extraction shells out to the
 * `tesseract` binary, which must be installed on the host (see extractText).
 */
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

/** MRZ character value for the check-digit algorithm. */
const charValue = (c) => {
  if (c >= '0' && c <= '9') return c.charCodeAt(0) - 48;
  if (c >= 'A' && c <= 'Z') return c.charCodeAt(0) - 55; // A=10 .. Z=35
  return 0; // '<' filler
};

/** ICAO 9303 check digit: weights cycle 7,3,1. */
const checkDigit = (input) => {
  const weights = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < input.length; i += 1) sum += charValue(input[i]) * weights[i % 3];
  return sum % 10;
};

const validates = (field, digit) => {
  if (!/^\d$/.test(digit)) return false;
  return checkDigit(field) === Number(digit);
};

const clean = (v) => String(v || '').replace(/</g, ' ').trim();

/**
 * YYMMDD -> ISO date. `kind` disambiguates the century: an expiry is always in
 * the future-ish, a birth date always in the past.
 */
const toISODate = (yymmdd, kind) => {
  if (!/^\d{6}$/.test(yymmdd)) return null;
  const yy = Number(yymmdd.slice(0, 2));
  const mm = yymmdd.slice(2, 4);
  const dd = yymmdd.slice(4, 6);
  if (Number(mm) < 1 || Number(mm) > 12 || Number(dd) < 1 || Number(dd) > 31) return null;
  const nowYY = new Date().getFullYear() % 100;
  const century = kind === 'birth' ? (yy > nowYY ? 1900 : 2000) : yy < 70 ? 2000 : 1900;
  return `${century + yy}-${mm}-${dd}`;
};

// ISO 3166-1 alpha-3 -> display name. Deliberately partial: the region's common
// issuers plus frequent source countries. Anything unlisted returns the raw
// code with confidence 'low' so the counsellor picks it from the dropdown
// rather than being shown a wrong country.
const ALPHA3 = {
  KWT: 'Kuwait', SAU: 'Saudi Arabia', ARE: 'UAE', QAT: 'Qatar', BHR: 'Bahrain',
  OMN: 'Oman', EGY: 'Egypt', JOR: 'Jordan', LBN: 'Lebanon', SYR: 'Syria',
  IRQ: 'Iraq', YEM: 'Yemen', PSE: 'Palestine', SDN: 'Sudan', IND: 'India',
  PAK: 'Pakistan', BGD: 'Bangladesh', LKA: 'Sri Lanka', PHL: 'Philippines',
  GBR: 'United Kingdom', USA: 'United States', CAN: 'Canada', AUS: 'Australia',
  IRL: 'Ireland', TUR: 'Turkey', NGA: 'Nigeria', KEN: 'Kenya', ZAF: 'South Africa',
};

/**
 * The shape of a TD3 second line: 9 doc chars + check, 3-letter nationality,
 * 6-digit DOB + check, sex, 6-digit expiry + check. Distinctive enough to find
 * in noisy output, and it is the line every extracted field comes from.
 */
const LINE2_SIGNATURE = /[A-Z0-9<]{9}\d[A-Z<]{3}\d{6}\d[MFX<]\d{6}\d/;

/**
 * Pull the TD3 lines out of OCR text.
 *
 * Deliberately does NOT require two 44-character lines. Two things break that
 * assumption in practice:
 *   - OCR collapses long runs of the '<' filler, so line 1 commonly comes back
 *     far short of 44 characters.
 *   - Line 1 carries only the names, which are a bonus. Every field we return
 *     comes from line 2, so line 2 is the anchor and line 1 is optional.
 */
const findMrzLines = (text) => {
  const lines = String(text || '')
    .toUpperCase()
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ''))
    .filter((l) => l.length >= 20 && /^[A-Z0-9<]+$/.test(l));

  for (let i = 0; i < lines.length; i += 1) {
    const candidate = lines[i].padEnd(44, '<').slice(0, 44);
    if (!LINE2_SIGNATURE.test(candidate)) continue;
    // The names line is whichever preceding line starts with the document code.
    const prev = i > 0 ? lines[i - 1].padEnd(44, '<').slice(0, 44) : '';
    return [prev.startsWith('P') ? prev : '', candidate];
  }
  return null;
};

/**
 * Parse TD3 MRZ lines into fields. Every value carries its own validity, so the
 * caller can show only what the check digits confirmed.
 */
const parseTD3 = ([l1, l2]) => {
  // l1 may be absent — OCR often mangles or truncates the names line. The
  // fields that matter all come from l2, so a missing l1 costs only the name.
  const names = (l1 || '').slice(5).split('<<');
  const surname = clean(names[0]);
  const given = clean((names[1] || '').replace(/</g, ' '));

  const passportNo = l2.slice(0, 9);
  const passportNoCheck = l2[9];
  const nationality3 = l2.slice(10, 13);
  const dob = l2.slice(13, 19);
  const dobCheck = l2[19];
  const expiry = l2.slice(21, 27);
  const expiryCheck = l2[27];
  const personal = l2.slice(28, 42);
  const personalCheck = l2[42];

  const natName = ALPHA3[nationality3] || null;

  return {
    // MRZ-backed, check-digit validated
    passportNumber: validates(passportNo, passportNoCheck) ? clean(passportNo) : null,
    dateOfExpiry: validates(expiry, expiryCheck) ? toISODate(expiry, 'expiry') : null,
    dateOfBirth: validates(dob, dobCheck) ? toISODate(dob, 'birth') : null,
    nationality: natName,
    nationalityCode: nationality3,
    // Optional field: present only when the issuer populates it.
    civilNumber: validates(personal, personalCheck) && clean(personal) ? clean(personal) : null,
    firstName: given || null,
    lastName: surname || null,
    // NOT in the MRZ — the caller collects these manually. See header.
    dateOfIssue: null,
    placeOfIssue: null,
    placeOfBirth: null,
    unavailable: ['dateOfIssue', 'placeOfIssue', 'placeOfBirth'],
    lowConfidence: natName ? [] : ['nationality'],
  };
};

/**
 * OCR a file to text using the host `tesseract` binary.
 *
 * Chosen over an npm OCR package on purpose: it adds no dependency to
 * package.json and keeps the passport image on this machine. The trade-off is a
 * host requirement — `apt-get install tesseract-ocr` — so the caller must treat
 * a missing binary as "extraction unavailable", never as a failed upload.
 */
const MRZ_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<';

/**
 * OCR a file to text using the host `tesseract` binary.
 *
 * The character whitelist is not optional. Without it tesseract reads the MRZ's
 * '<' fillers as 'c' and 'e' — verified against a rendered MRZ, where a clean
 * line came back as "REEM<<<<<<<<<<ccececececeeeece" and failed every
 * downstream check. Constraining the alphabet to the 37 characters the MRZ can
 * legally contain removes that class of error outright.
 *
 * Several page-segmentation modes are tried because the right one depends on
 * how much of the page the photo includes; the first output containing a valid
 * line-2 signature wins.
 */
const extractText = async (filePath) => {
  const modes = ['6', '4', '11'];
  let last = '';
  for (const psm of modes) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const { stdout } = await execFileAsync(
        'tesseract',
        [filePath, 'stdout', '--psm', psm, '-c', `tessedit_char_whitelist=${MRZ_ALPHABET}`],
        { timeout: 20000, maxBuffer: 4 * 1024 * 1024 },
      );
      last = stdout;
      if (findMrzLines(stdout)) return stdout;
    } catch (err) {
      // A missing binary must surface; a mode that simply fails should not.
      if (err && err.code === 'ENOENT') throw err;
    }
  }
  return last;
};

/**
 * Entry point. Takes a buffer, returns parsed fields or a reason it could not.
 * Never throws at the caller: extraction is an optimisation, not a gate.
 */
const extractPassport = async (buffer, originalName = 'passport') => {
  const ext = (path.extname(originalName) || '.png').toLowerCase();
  const tmp = path.join(os.tmpdir(), `pp_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);

  try {
    await fs.promises.writeFile(tmp, buffer);
    const text = await extractText(tmp);
    const lines = findMrzLines(text);
    if (!lines) {
      return { ok: false, reason: 'NO_MRZ_FOUND', fields: null };
    }
    return { ok: true, fields: parseTD3(lines) };
  } catch (err) {
    const missingBinary = err && (err.code === 'ENOENT' || /not found/i.test(err.message || ''));
    return {
      ok: false,
      reason: missingBinary ? 'OCR_UNAVAILABLE' : 'EXTRACTION_FAILED',
      detail: err && err.message,
      fields: null,
    };
  } finally {
    // PII: the scan never outlives the request.
    fs.promises.unlink(tmp).catch(() => {});
  }
};

module.exports = { extractPassport, parseTD3, findMrzLines, checkDigit, toISODate };
