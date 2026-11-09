const httpStatus = require('http-status');
const admin = require('firebase-admin');
const ApiError = require('../utils/ApiError');
const config = require('../config/config');
const firebaseAuthService = require('./firebaseAuth.service');
const { parsePhone } = require('../utils/ulearnPhone');

/**
 * SMS-OTP fallback: Twilio Verify → Firebase custom token.
 *
 * WHY THIS EXISTS
 * ---------------
 * Firebase phone auth sends its own SMS and, for some carriers, Google's route
 * simply refuses the number — STC Kuwait (+9655…) fails from any device with
 * `503 / "Error code: 39" / backendError` while Zain and Ooredoo deliver fine.
 * Nothing in the Firebase console fixes that, and Firebase offers no way to
 * plug in another SMS provider. So when Firebase refuses, the frontend asks
 * THIS backend to send the code through Twilio Verify instead.
 *
 * WHY THE RESULT IS STILL A FIREBASE IDENTITY
 * ------------------------------------------
 * Every ulearn student is keyed on `firebaseUid` (see
 * ulearnStudent.service upsertFromPhonePayload). If this path issued its own
 * session we'd have two identity systems and a student who signed in once by
 * Firebase SMS and once by Twilio would become two accounts. Instead, once
 * Twilio confirms the code, we look up or create the Firebase user for that
 * phone number and mint a CUSTOM TOKEN for it. The frontend signs into
 * Firebase with that token and continues through the existing
 * POST /auth/phone exchange — same uid, same student record, same JWT.
 *
 * WHAT THE CLIENT IS TRUSTED WITH
 * -------------------------------
 * Nothing. The phone number in the request body is only the DESTINATION of an
 * SMS; identity is established solely by Twilio confirming the code that was
 * delivered to it. The custom token is minted for whatever number Twilio
 * approved, and the phone number itself is written into the Firebase user
 * record, so the ID token the frontend eventually presents carries a
 * `phone_number` claim exactly like a native phone sign-in.
 *
 * Twilio is called over its REST API with Node's built-in fetch — no SDK, no
 * new dependency, three requests in total.
 */

const TWILIO_BASE = 'https://verify.twilio.com/v2/Services';

/** @returns {boolean} whether Twilio Verify is configured at all */
const isTwilioConfigured = () => {
  const t = config.ulearnStudents.twilio;
  return Boolean(t.accountSid && t.authToken && t.verifyServiceSid);
};

/**
 * Minting a custom token is a SIGNING operation and needs a service account
 * for the ulearn-abroad project — unlike ID-token verification, which only
 * needs the project id. Without the key this whole path is unavailable.
 */
const canMintCustomTokens = () => {
  const fb = config.ulearnStudents.firebase;
  return Boolean(fb.projectId && fb.clientEmail && fb.privateKey);
};

const isConfigured = () => isTwilioConfigured() && canMintCustomTokens();

const requireConfigured = () => {
  if (!isTwilioConfigured()) {
    throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'SMS fallback is not configured (Twilio)');
  }
  if (!canMintCustomTokens()) {
    // eslint-disable-next-line no-console
    console.error(
      'ulearn otp fallback: ULEARN_FIREBASE_CLIENT_EMAIL / ULEARN_FIREBASE_PRIVATE_KEY are required ' +
        'to mint custom tokens — set a service-account key for the ulearn-abroad project'
    );
    throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'SMS fallback is not configured (Firebase credentials)');
  }
};

/**
 * Normalise the destination. Refuses anything that isn't an unambiguous
 * international number — the same rule the identity code applies.
 * @param {string} raw
 * @returns {string} E.164
 */
const toE164 = (raw) => {
  const parsed = parsePhone(raw);
  if (parsed.form !== 'international' || !parsed.e164) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Phone number must include a country code, e.g. +96551234567');
  }
  return parsed.e164;
};

const twilioAuthHeader = () => {
  const t = config.ulearnStudents.twilio;
  const user = t.apiKeySid || t.accountSid;
  return `Basic ${Buffer.from(`${user}:${t.authToken}`).toString('base64')}`;
};

/**
 * One Twilio Verify call.
 * @param {'Verifications'|'VerificationCheck'} resource
 * @param {Record<string,string>} form
 */
const twilioPost = async (resource, form) => {
  const t = config.ulearnStudents.twilio;
  const url = `${TWILIO_BASE}/${t.verifyServiceSid}/${resource}`;
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: twilioAuthHeader(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(form).toString(),
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('ulearn otp fallback: could not reach Twilio', err.message);
    throw new ApiError(httpStatus.BAD_GATEWAY, 'SMS service is unreachable right now');
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    // Twilio error codes worth telling apart. Full list:
    // https://www.twilio.com/docs/api/errors
    const code = body && body.code;
    // eslint-disable-next-line no-console
    console.error('ulearn otp fallback: Twilio rejected the request', {
      resource,
      status: response.status,
      code,
      message: body && body.message,
    });
    if (code === 60200) throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid phone number');
    if (code === 60203)
      throw new ApiError(
        httpStatus.TOO_MANY_REQUESTS,
        'Too many codes sent to this number. Please wait before trying again.'
      );
    if (code === 60202) throw new ApiError(httpStatus.TOO_MANY_REQUESTS, 'Too many attempts. Please request a new code.');
    if (code === 60205) throw new ApiError(httpStatus.BAD_REQUEST, 'SMS cannot be delivered to a landline number');
    if (code === 60220 || code === 60410)
      throw new ApiError(httpStatus.BAD_REQUEST, 'This number is blocked from receiving codes');
    if (code === 20404) {
      // VerificationCheck 404: no pending verification — expired or never sent
      throw new ApiError(httpStatus.UNAUTHORIZED, 'That code has expired. Please request a new one.');
    }
    if (response.status === 401 || response.status === 403) {
      throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'SMS fallback is misconfigured on the server');
    }
    throw new ApiError(httpStatus.BAD_GATEWAY, 'SMS service failed. Please try again.');
  }
  return body;
};

/**
 * Send a verification code by SMS through Twilio Verify.
 * @param {string} rawPhone
 * @returns {Promise<{phone: string, status: string}>}
 */
const startVerification = async (rawPhone) => {
  requireConfigured();
  const phone = toE164(rawPhone);
  const result = await twilioPost('Verifications', { To: phone, Channel: 'sms' });
  return { phone, status: result.status || 'pending' };
};

/**
 * Check the code with Twilio; if approved, return a Firebase custom token for
 * the user whose phone number this is (creating that user on first sight).
 * @param {string} rawPhone
 * @param {string} code
 * @returns {Promise<{customToken: string, phone: string}>}
 */
const checkVerification = async (rawPhone, code) => {
  requireConfigured();
  const phone = toE164(rawPhone);
  const digits = String(code || '').replace(/\D/g, '');
  if (digits.length < 4 || digits.length > 10) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Verification code is required');
  }

  const result = await twilioPost('VerificationCheck', { To: phone, Code: digits });
  if (result.status !== 'approved') {
    // Twilio answers 200 with status "pending" for a wrong code
    throw new ApiError(httpStatus.UNAUTHORIZED, 'That code is not right. Check it and try again.');
  }

  // Twilio proved possession of `phone`. Now bind that to a Firebase identity.
  const app = firebaseAuthService.getApp();
  const auth = admin.auth(app);
  let user;
  try {
    user = await auth.getUserByPhoneNumber(phone);
  } catch (err) {
    if (err.code !== 'auth/user-not-found') {
      // eslint-disable-next-line no-console
      console.error('ulearn otp fallback: Firebase user lookup failed', { code: err.code, message: err.message });
      throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Sign-in is unavailable right now');
    }
    try {
      user = await auth.createUser({ phoneNumber: phone });
    } catch (createErr) {
      // eslint-disable-next-line no-console
      console.error('ulearn otp fallback: Firebase createUser failed', {
        code: createErr.code,
        message: createErr.message,
      });
      throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Sign-in is unavailable right now');
    }
  }
  if (user.disabled) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'This account has been disabled. Please contact support.');
  }

  let customToken;
  try {
    // `otpChannel` is a developer claim only — it does NOT survive into the ID
    // token's phone identity, and the /auth/phone exchange never reads it. It
    // is there so the Firebase-side logs show which route the sign-in took.
    customToken = await auth.createCustomToken(user.uid, { otpChannel: 'twilio' });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('ulearn otp fallback: createCustomToken failed', { code: err.code, message: err.message });
    throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Sign-in is unavailable right now');
  }
  return { customToken, phone };
};

module.exports = {
  isConfigured,
  startVerification,
  checkVerification,
};
