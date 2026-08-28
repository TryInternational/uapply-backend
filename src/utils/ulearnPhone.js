/**
 * Phone normalisation for ulearn-student identity and attempt claiming.
 *
 * WHY THIS EXISTS
 * ---------------
 * The three test collections stored phone numbers free-form over several years,
 * under three different field names and three different shapes:
 *
 *   IeltsTest.phone   dial code + national digits, `+` and spaces stripped by a
 *                     pre-save hook            → "96555001122"
 *   AptitudeTest.number  free-form digits, historically often national-only
 *                     with no country code     → "55001122"
 *   Major.phoneNo     national digits, with the dial code in a SEPARATE
 *                     `countryCode` field      → { countryCode:"+965", phoneNo:"55001122" }
 *
 * Firebase gives us one thing we can actually trust: an E.164 number it proved
 * the student controls by SMS. Everything here exists to answer one question
 * safely — "is this stored string the same number as that verified one?" — and
 * to answer "I don't know" rather than guess, because a wrong guess hands one
 * student another student's test results.
 *
 * Every function here is pure. No I/O, no database, no config.
 */

/** Arabic-Indic and Eastern Arabic-Indic digits → ASCII. Forms are typed on
 *  Arabic keyboards, so stored numbers really do contain these. */
const ARABIC_DIGITS = /[٠-٩۰-۹]/g;
const toAsciiDigits = (value) =>
  value.replace(ARABIC_DIGITS, (d) => {
    const code = d.charCodeAt(0);
    const base = code >= 0x06f0 ? 0x06f0 : 0x0660;
    return String(code - base);
  });

/** Dial codes we can recognise, longest first so "+1268" wins over "+1". */
const DIAL_CODES = [
  '1242', '1246', '1264', '1268', '1284', '1340', '1345', '1441', '1473', '1649', '1664', '1670', '1671',
  '1684', '1721', '1758', '1767', '1784', '1809', '1829', '1849', '1868', '1869', '1876', '1939',
  '210', '211', '212', '213', '216', '218', '220', '221', '222', '223', '224', '225', '226', '227', '228',
  '229', '230', '231', '232', '233', '234', '235', '236', '237', '238', '239', '240', '241', '242', '243',
  '244', '245', '246', '248', '249', '250', '251', '252', '253', '254', '255', '256', '257', '258', '260',
  '261', '262', '263', '264', '265', '266', '267', '268', '269', '290', '291', '297', '298', '299',
  '350', '351', '352', '353', '354', '355', '356', '357', '358', '359', '370', '371', '372', '373', '374',
  '375', '376', '377', '378', '380', '381', '382', '383', '385', '386', '387', '389',
  '420', '421', '423', '500', '501', '502', '503', '504', '505', '506', '507', '508', '509',
  '590', '591', '592', '593', '594', '595', '596', '597', '598', '599',
  '670', '672', '673', '674', '675', '676', '677', '678', '679', '680', '681', '682', '683', '685', '686',
  '687', '688', '689', '690', '691', '692',
  '850', '852', '853', '855', '856', '870', '880', '886',
  '960', '961', '962', '963', '964', '965', '966', '967', '968', '970', '971', '972', '973', '974', '975',
  '976', '977', '992', '993', '994', '995', '996', '998',
  '20', '27', '30', '31', '32', '33', '34', '36', '39', '40', '41', '43', '44', '45', '46', '47', '48',
  '49', '51', '52', '53', '54', '55', '56', '57', '58', '60', '61', '62', '63', '64', '65', '66', '81',
  '82', '84', '86', '90', '91', '92', '93', '94', '95', '98',
  '7', '1',
].sort((a, b) => b.length - a.length);

/** Longest dial code that prefixes `digits`, or null. */
const matchDialCode = (digits) => DIAL_CODES.find((code) => digits.startsWith(code)) || null;

/**
 * A number is only usable as an identity claim if it is long enough to be a
 * real subscriber number. Seven is the shortest national number in use; below
 * that, collisions across the dataset are near-certain.
 */
const MIN_NATIONAL_DIGITS = 7;
const MAX_E164_DIGITS = 15; // ITU-T E.164 hard limit

/**
 * @typedef {Object} ParsedPhone
 * @property {string|null} e164      "+96555001122" when the country is known
 * @property {string|null} dialCode  "965" when the country is known
 * @property {string} national       digits after the dial code, or all digits
 *                                   when no country could be determined
 * @property {'international'|'national'|'none'} form
 *   international — the country code is explicit and trustworthy
 *   national      — digits only, country unknown; matchable but ambiguous
 *   none          — unusable (empty, too short, too long)
 */

/**
 * Normalise any stored or submitted phone string.
 *
 * `+` and `00` are the only two markers that a country code is really present.
 * A bare digit string that HAPPENS to start with "965" is NOT treated as
 * international — Kuwaiti mobiles genuinely start with 9, so "96555001122"
 * read as national is a plausible number too. Guessing here is precisely the
 * mistake that would let one student claim another's attempts, so instead the
 * caller gets `form: 'national'` and must apply the ambiguity guard.
 *
 * The one exception is `explicitDialCode`, which Major supplies in its own
 * `countryCode` column: that is a real, separately-recorded country, so it is
 * trusted the same way a leading `+` is.
 *
 * @param {string} raw
 * @param {string} [explicitDialCode] e.g. "+965" or "965" from a sibling column
 * @returns {ParsedPhone}
 */
const parsePhone = (raw, explicitDialCode) => {
  const empty = { e164: null, dialCode: null, national: '', form: 'none' };
  if (raw === null || raw === undefined) return empty;

  const text = toAsciiDigits(String(raw)).trim();
  if (!text) return empty;

  // does the string itself declare an international prefix?
  const hasPlus = text.startsWith('+');
  const digitsOnly = text.replace(/\D/g, '');
  const hasZeroZero = !hasPlus && digitsOnly.startsWith('00');

  let digits = digitsOnly;
  let international = hasPlus;
  if (hasZeroZero) {
    digits = digits.slice(2);
    international = true;
  }

  if (!digits) return empty;

  if (international) {
    const dialCode = matchDialCode(digits);
    if (!dialCode) return empty; // "+999…" — not a country we know; refuse
    const national = digits.slice(dialCode.length);
    if (national.length < MIN_NATIONAL_DIGITS || digits.length > MAX_E164_DIGITS) return empty;
    return { e164: `+${digits}`, dialCode, national, form: 'international' };
  }

  // a sibling column told us the country
  if (explicitDialCode) {
    const code = toAsciiDigits(String(explicitDialCode)).replace(/\D/g, '');
    if (code && DIAL_CODES.includes(code)) {
      // the national part sometimes already repeats the dial code
      const national = digits.startsWith(code) && digits.length - code.length >= MIN_NATIONAL_DIGITS
        ? digits.slice(code.length)
        : digits;
      if (national.length < MIN_NATIONAL_DIGITS || code.length + national.length > MAX_E164_DIGITS) return empty;
      return { e164: `+${code}${national}`, dialCode: code, national, form: 'international' };
    }
  }

  // digits with no declared country — matchable, but only under the guard
  const national = digits.replace(/^0+/, '') || digits; // strip a national trunk "0"
  if (national.length < MIN_NATIONAL_DIGITS || national.length > MAX_E164_DIGITS) return empty;
  return { e164: null, dialCode: null, national, form: 'national' };
};

/**
 * Compare a stored phone against the Firebase-verified one.
 *
 * @param {ParsedPhone} stored
 * @param {ParsedPhone} verified - must be form 'international' (it came from Firebase)
 * @returns {'exact'|'national'|null}
 *   exact    — the two numbers agree on BOTH country code and subscriber
 *              digits. Safe to claim with no further checks.
 *   national — the stored number named no country and only its subscriber
 *              digits match. Only safe once the caller has confirmed no other
 *              account owns the same subscriber digits under a different
 *              country code.
 *   null     — no match, or not enough information to say.
 */
const matchPhone = (stored, verified) => {
  if (!stored || !verified || verified.form !== 'international' || !verified.e164) return null;

  if (stored.form === 'international') {
    return stored.e164 === verified.e164 ? 'exact' : null;
  }

  if (stored.form === 'national') {
    // IeltsTest's pre-save hook strips the "+" from every number it stores, so
    // the single most common historical shape is the FULL international number
    // as bare digits: "96555001122". Read strictly that is "form: national",
    // but the digits still encode the country, so treating it as exact is both
    // correct and necessary — without this branch no IELTS attempt could ever
    // be claimed by phone.
    //
    // It is also the safer of the two national comparisons: a string that
    // happens to equal another person's complete international number, country
    // code and all, is far less likely than a bare subscriber-number collision.
    if (verified.dialCode && stored.national === `${verified.dialCode}${verified.national}`) {
      return 'exact';
    }
    return stored.national === verified.national ? 'national' : null;
  }

  return null;
};

/** Convenience: parse both sides then compare. */
const comparePhones = (storedRaw, verifiedE164, storedDialCode) =>
  matchPhone(parsePhone(storedRaw, storedDialCode), parsePhone(verifiedE164));

module.exports = {
  parsePhone,
  matchPhone,
  comparePhones,
  MIN_NATIONAL_DIGITS,
  MAX_E164_DIGITS,
  // exported for tests
  _dialCodes: DIAL_CODES,
};
