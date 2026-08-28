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

module.exports = {
  firestore,
  uploadBuffer,
};
