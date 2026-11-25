/**
 * Stand-in for "firebase-admin" during tests (moduleNameMapper in
 * jest.config.js). No Firebase project is contacted and no service-account key
 * is needed or checked.
 *
 * It covers what the code uses: initializeApp, credential.cert, apps,
 * firestore(), storage().bucket() and auth(). Reads find nothing and writes
 * are kept in `writes`. Token checks fail unless the test says otherwise, so no
 * test is signed in by accident:
 *
 *   const admin = require('firebase-admin');
 *   admin.state.verifiedToken = { uid: 'u1', phone_number: '+96500000001' };
 *
 * A method this file does not have will throw "is not a function" in the
 * test that needs it. Add it here then; do not reach for the real package.
 *
 * Plain functions on purpose, not jest.fn(): see tests/mocks/resend.js.
 */
const apps = [];
const writes = [];
const state = { verifiedToken: null };

const emptySnapshot = { exists: false, empty: true, size: 0, docs: [], data: () => undefined, forEach: () => {} };

const docRef = (path) => ({
  id: path.split('/').pop(),
  path,
  get: async () => emptySnapshot,
  set: async (data) => {
    writes.push({ op: 'set', path, data });
  },
  update: async (data) => {
    writes.push({ op: 'update', path, data });
  },
  delete: async () => {
    writes.push({ op: 'delete', path });
  },
});

const collectionRef = (name) => {
  const query = {
    where: () => query,
    orderBy: () => query,
    limit: () => query,
    get: async () => emptySnapshot,
    doc: (id = `test-doc-${writes.length + 1}`) => docRef(`${name}/${id}`),
    add: async (data) => {
      const ref = docRef(`${name}/test-doc-${writes.length + 1}`);
      writes.push({ op: 'add', path: ref.path, data });
      return ref;
    },
  };
  return query;
};

const firestoreInstance = { collection: collectionRef, doc: docRef };

const fileRef = (bucketName, name) => ({
  name,
  save: async (contents, options) => {
    writes.push({ op: 'storage.save', path: `${bucketName}/${name}`, options });
  },
  exists: async () => [false],
  delete: async () => {
    writes.push({ op: 'storage.delete', path: `${bucketName}/${name}` });
  },
  makePublic: async () => {},
  getSignedUrl: async () => [`https://storage.invalid/${bucketName}/${name}?signed=test`],
  publicUrl: () => `https://storage.invalid/${bucketName}/${name}`,
});

const storageInstance = {
  bucket: (name = 'test-bucket') => ({ name, file: (fileName) => fileRef(name, fileName) }),
};

const authInstance = {
  verifyIdToken: async () => {
    if (!state.verifiedToken) throw new Error('firebase-admin stand-in: no verified token was set for this test');
    return state.verifiedToken;
  },
  getUser: async (uid) => ({ uid }),
  createCustomToken: async (uid) => `test-custom-token-${uid}`,
};

const makeApp = (options, name = '[DEFAULT]') => ({
  name,
  options,
  firestore: () => firestoreInstance,
  storage: () => storageInstance,
  auth: () => authInstance,
});

const reset = () => {
  writes.length = 0;
  state.verifiedToken = null;
};

module.exports = {
  apps,
  writes,
  state,
  reset,
  initializeApp: (options, name) => {
    const app = makeApp(options, name);
    apps.push(app);
    return app;
  },
  app: (name = '[DEFAULT]') => apps.find((a) => a.name === name) || makeApp({}, name),
  credential: {
    cert: (serviceAccount) => ({ type: 'test-credential', projectId: serviceAccount && serviceAccount.project_id }),
    applicationDefault: () => ({ type: 'test-credential' }),
  },
  firestore: () => firestoreInstance,
  storage: () => storageInstance,
  auth: () => authInstance,
};
