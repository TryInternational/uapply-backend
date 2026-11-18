const admin = require('firebase-admin');

const config = require('../config/config');

admin.initializeApp({
  credential: admin.credential.cert(config.firebase_service),
  databaseURL: 'https://digital-vim-270607.firebaseio.com',
  storageBucket: config.whatsapp.mediaBucket,
});

const firestore = async () => {
  const db = admin.firestore();
  return db;
};

/**
 * Upload a buffer to the storage bucket and return a public URL. Used to persist
 * inbound WhatsApp media fetched from Meta. Best-effort: callers should tolerate
 * a thrown error (e.g. bucket not configured) and fall back to no stored URL.
 * @param {Buffer} buffer
 * @param {string} destination - object path within the bucket
 * @param {string} contentType - mime type
 * @returns {Promise<string>} public URL
 */
const uploadBuffer = async (buffer, destination, contentType) => {
  const bucket = admin.storage().bucket(config.whatsapp.mediaBucket);
  const file = bucket.file(destination);
  await file.save(buffer, { contentType, resumable: false, public: true });
  return `https://storage.googleapis.com/${bucket.name}/${destination}`;
};

/**
 * Store a buffer WITHOUT making it public. For identity documents: the object
 * is reachable only through signedReadUrl below (or the console). Same bucket
 * as uploadBuffer; the path decides the folder.
 */
const uploadPrivateBuffer = async (buffer, destination, contentType) => {
  const bucket = admin.storage().bucket(config.whatsapp.mediaBucket);
  const file = bucket.file(destination);
  await file.save(buffer, { contentType, resumable: false, public: false });
  return destination;
};

/**
 * A V4 signed URL that reads one private object for `minutes`. Signed with the
 * service account's own key (admin.credential.cert above), so no IAM
 * signBlob permission is needed.
 */
const signedReadUrl = async (destination, minutes = 10) => {
  const bucket = admin.storage().bucket(config.whatsapp.mediaBucket);
  const [url] = await bucket.file(destination).getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: Date.now() + minutes * 60 * 1000,
  });
  return url;
};

/** Read a private object back (signature PNGs are composited into PDFs server-side). */
const downloadBuffer = async (destination) => {
  const bucket = admin.storage().bucket(config.whatsapp.mediaBucket);
  const [buf] = await bucket.file(destination).download();
  return buf;
};

/** Make a stored object world-readable and return its public URL. */
const makePublic = async (destination) => {
  const bucket = admin.storage().bucket(config.whatsapp.mediaBucket);
  await bucket.file(destination).makePublic();
  return `https://storage.googleapis.com/${bucket.name}/${destination}`;
};

module.exports = {
  firestore,
  uploadBuffer,
  uploadPrivateBuffer,
  signedReadUrl,
  downloadBuffer,
  makePublic,
};
