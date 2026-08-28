const httpStatus = require('http-status');
const admin = require('firebase-admin');
const ApiError = require('../utils/ApiError');
const config = require('../config/config');

/**
 * Server-side verification of Firebase ID tokens for ulearn phone sign-in.
 *
 * The frontend runs the SMS/OTP exchange with Firebase and receives an ID
 * token. That token is the ONLY thing the client sends us — the phone number
 * itself is never trusted from the request body, because a client can type any
 * number it likes. Firebase signs the phone number into the token; we read it
 * from the verified payload.
 *
 * WHICH PROJECT
 * -------------
 * Tokens are issued by the FRONTEND's Firebase project (`ulearn-abroad`, see
 * src/firebase.js there). The pre-existing FIREBASE_* service account in this
 * backend belongs to a DIFFERENT project (`digital-vim-270607`) and is used for
 * the WhatsApp media bucket — verifying against it rejects every token with an
 * audience mismatch. So this service reads its own ULEARN_FIREBASE_* config and
 * never touches config.firebase_service.
 *
 * WHY NO CREDENTIAL IS REQUIRED
 * -----------------------------
 * Verifying an ID token is a PUBLIC-KEY operation: the SDK fetches Google's
 * published certificates and checks the signature, plus the `aud`/`iss` claims
 * against a project id. None of that needs a service account. Credentials are
 * only needed for `checkRevoked`, which calls the Auth API.
 *
 * So the project id alone — a non-secret string — is enough to make phone
 * sign-in work in every environment. Supplying ULEARN_FIREBASE_CLIENT_EMAIL and
 * ULEARN_FIREBASE_PRIVATE_KEY is optional and buys exactly one thing:
 * revocation checking.
 *
 * A NAMED app is used so this can never collide with a default
 * `admin.initializeApp()` elsewhere in the process.
 */

const APP_NAME = 'ulearn-auth';

let cachedApp = null;

/** @returns {boolean} whether we know which project issues the tokens */
const isConfigured = () => Boolean(config.ulearnStudents.firebase.projectId);

/** @returns {boolean} whether we can additionally check for revoked tokens */
const canCheckRevocation = () => {
  const fb = config.ulearnStudents.firebase;
  return Boolean(fb.clientEmail && fb.privateKey);
};

/**
 * Lazily initialise (and memoise) the named admin app.
 * Lazy so a deployment with no Firebase config still boots — the phone-auth
 * endpoint then returns a clean 503 instead of crashing the process.
 */
const getApp = () => {
  if (cachedApp) return cachedApp;
  if (!isConfigured()) {
    throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Phone sign-in is not configured');
  }
  const fb = config.ulearnStudents.firebase;
  const existing = admin.apps.find((a) => a && a.name === APP_NAME);
  if (existing) {
    cachedApp = existing;
    return cachedApp;
  }

  const options = { projectId: fb.projectId };
  if (canCheckRevocation()) {
    options.credential = admin.credential.cert({
      projectId: fb.projectId,
      clientEmail: fb.clientEmail,
      privateKey: fb.privateKey,
    });
  }

  try {
    cachedApp = admin.initializeApp(options, APP_NAME);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('ulearn phone auth: could not initialise the Firebase admin app', err.message);
    throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Phone sign-in is not configured');
  }
  return cachedApp;
};

/** Error codes that genuinely mean "this token is bad" — the student's problem. */
const TOKEN_FAULTS = new Set([
  'auth/id-token-expired',
  'auth/id-token-revoked',
  'auth/invalid-id-token',
  'auth/argument-error',
]);

/**
 * Turn a firebase-admin verification error into the right HTTP response.
 *
 * The distinction that matters: a bad token is 401 and the student should try
 * again; a misconfigured backend is 503 and retrying will never help. Telling a
 * student "invalid or expired code" when the real problem is that the server
 * points at the wrong Firebase project sends them round a loop forever.
 *
 * @param {Error} err
 * @returns {ApiError}
 */
const describeVerifyFailure = (err) => {
  const code = err.code || '';
  const message = err.message || '';

  // Wrong project: the token's audience/issuer names a different Firebase
  // project than the service account this server holds. firebase-admin spells
  // both project ids out in the message, so it is already in the log above.
  if (message.includes('incorrect "aud"') || message.includes('incorrect "iss"')) {
    // eslint-disable-next-line no-console
    console.error(
      'ulearn phone auth: PROJECT MISMATCH — the frontend signed in against a different ' +
        `Firebase project than ULEARN_FIREBASE_PROJECT_ID (${config.ulearnStudents.firebase.projectId}). ` +
        'Compare it with projectId in the frontend src/firebase.js.'
    );
    return new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Phone sign-in is misconfigured on the server');
  }

  // Bad credentials / missing permissions: also ours, not the student's.
  if (
    code === 'auth/insufficient-permission' ||
    code === 'auth/invalid-credential' ||
    code === 'auth/internal-error' ||
    message.includes('Credential implementation') ||
    message.includes('Failed to determine project ID')
  ) {
    return new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Phone sign-in is misconfigured on the server');
  }

  if (code === 'auth/id-token-expired') {
    return new ApiError(httpStatus.UNAUTHORIZED, 'Your sign-in took too long. Please request a new code.');
  }

  return new ApiError(httpStatus.UNAUTHORIZED, 'Invalid or expired sign-in token');
};

/**
 * Verify a Firebase ID token and return the phone identity it proves.
 *
 * Checks beyond the signature, each of which matters:
 *  1. `checkRevoked` — only when credentials make it possible. A session the
 *     student (or we) revoked should stop working immediately, not at expiry.
 *  2. `sign_in_provider === 'phone'` — an ID token from ANY provider on this
 *     Firebase project would otherwise be accepted here. Without this check, a
 *     token minted by, say, anonymous or email sign-in could be presented to a
 *     phone-identity endpoint.
 *  3. `phone_number` present — belt and braces; a phone-provider token always
 *     carries it, and identity is meaningless without it.
 *
 * @param {string} idToken
 * @returns {Promise<{uid: string, phoneNumber: string, name: string, picture: string}>}
 */
const verifyFirebaseIdToken = async (idToken) => {
  const app = getApp();
  const withRevocationCheck = canCheckRevocation();
  let decoded;
  try {
    decoded = await admin.auth(app).verifyIdToken(idToken, withRevocationCheck);
  } catch (err) {
    const code = err.code || '';
    const message = err.message || String(err);

    // Always log the real reason. Collapsing every failure into a single 401
    // makes a project misconfiguration indistinguishable from a stale token,
    // which is a miserable thing to debug from the browser side.
    // eslint-disable-next-line no-console
    console.error('ulearn phone auth: token verification failed', {
      code: code || '(none)',
      message,
      expectedProjectId: config.ulearnStudents.firebase.projectId,
      revocationCheck: withRevocationCheck ? 'on' : 'off (no ULEARN_FIREBASE_* credentials)',
    });

    // A genuine revocation is a real 401. Anything else thrown by the
    // checkRevoked lookup (missing IAM permission, transient API failure) is
    // OUR problem, not the student's — retry without it rather than locking
    // everyone out. Note the trade-off: when the lookup cannot run we accept a
    // token that might have been revoked. Nothing in this service revokes
    // ulearn student tokens today, so the practical exposure is nil, and the
    // fallback is logged loudly so it cannot pass unnoticed.
    if (withRevocationCheck && code !== 'auth/id-token-revoked' && !TOKEN_FAULTS.has(code)) {
      try {
        decoded = await admin.auth(app).verifyIdToken(idToken);
        // eslint-disable-next-line no-console
        console.warn(
          'ulearn phone auth: token is valid but the revocation check could not run — ' +
            'verify the service account has the Firebase Authentication Admin role'
        );
      } catch (retryErr) {
        throw describeVerifyFailure(retryErr);
      }
    } else {
      throw describeVerifyFailure(err);
    }
  }

  const provider = decoded.firebase && decoded.firebase.sign_in_provider;
  if (provider !== 'phone') {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'This sign-in method is not accepted');
  }
  if (!decoded.phone_number || !decoded.uid) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Sign-in token carries no verified phone number');
  }

  return {
    uid: decoded.uid,
    phoneNumber: decoded.phone_number, // Firebase always emits E.164, e.g. "+96555001122"
    name: decoded.name || '',
    picture: decoded.picture || '',
  };
};

module.exports = {
  isConfigured,
  verifyFirebaseIdToken,
  // exported for tests/diagnostics
  _appName: APP_NAME,
};
