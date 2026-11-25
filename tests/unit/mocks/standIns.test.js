const path = require('path');
const resend = require('resend');
const slack = require('@slack/web-api');
const OpenAI = require('openai');
const admin = require('firebase-admin');
// Loading the app is what used to fail: config.js, the mail client and the
// Firebase client all needed real settings just to be required.
const app = require('../../../src/app');

// These tests check that requiring an outside client's package during tests
// gives the stand-in from tests/mocks, and that the stand-ins record what the
// code tried to do instead of doing it.

describe('stand-ins for outside services', () => {
  beforeEach(() => {
    resend.reset();
    slack.reset();
    OpenAI.reset();
    admin.reset();
  });

  test.each([
    ['resend', 'resend.js'],
    ['openai', 'openai.js'],
    ['@slack/web-api', 'slack-web-api.js'],
    ['firebase-admin', 'firebase-admin.js'],
  ])('requiring %s gives the stand-in', (name, file) => {
    expect(require.resolve(name)).toBe(path.join(__dirname, '../../mocks', file));
  });

  test('the application loads with no credential and builds its clients from the stand-ins', () => {
    expect(typeof app).toBe('function');
    expect(admin.apps.length).toBeGreaterThan(0);
  });

  test('resend records the message and sends nothing', async () => {
    const client = new resend.Resend('anything');
    const result = await client.emails.send({ to: 'someone@example.com', subject: 'Hello' });
    expect(result.error).toBeNull();
    expect(resend.sent).toEqual([{ to: 'someone@example.com', subject: 'Hello' }]);
  });

  test('slack records the message and posts nothing', async () => {
    const client = new slack.WebClient('anything');
    const result = await client.chat.postMessage({ channel: 'C000', text: 'Hello' });
    expect(result.ok).toBe(true);
    expect(slack.posted).toEqual([{ channel: 'C000', text: 'Hello' }]);
  });

  test('openai records the request and replies with what the test chose', async () => {
    OpenAI.nextReply.content = '{"score": 7}';
    const client = new OpenAI({ apiKey: 'anything' });
    const result = await client.chat.completions.create({ model: 'any', messages: [] });
    expect(result.choices[0].message.content).toBe('{"score": 7}');
    expect(OpenAI.requests).toHaveLength(1);
  });

  test('firebase-admin needs no key, finds nothing and records writes', async () => {
    const credential = admin.credential.cert({ project_id: 'p', private_key: 'not-a-key' });
    expect(credential.type).toBe('test-credential');
    const snapshot = await admin.firestore().collection('things').doc('one').get();
    expect(snapshot.exists).toBe(false);
    await admin.firestore().collection('things').doc('one').set({ a: 1 });
    expect(admin.writes).toEqual([{ op: 'set', path: 'things/one', data: { a: 1 } }]);
  });

  test('firebase-admin signs nobody in unless the test says so', async () => {
    await expect(admin.auth().verifyIdToken('any-token')).rejects.toThrow(/no verified token/);
    admin.state.verifiedToken = { uid: 'u1' };
    await expect(admin.auth().verifyIdToken('any-token')).resolves.toEqual({ uid: 'u1' });
  });
});
