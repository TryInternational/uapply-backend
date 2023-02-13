const admin = require('firebase-admin');

const config = require('../config/config');

admin.initializeApp({
  credential: admin.credential.cert(config.firebase_service),
  databaseURL: 'https://digital-vim-270607.firebaseio.com',
});

const firestore = async () => {
  const db = admin.firestore();
  return db;
};

module.exports = {
  firestore,
};
