/**
 * Stand-in for "@slack/web-api" during tests (moduleNameMapper in
 * jest.config.js). Nothing is posted. Every message the code tries to post is
 * kept in `posted`:
 *
 *   const { posted } = require('@slack/web-api');
 *   expect(posted[0].channel).toBe('...');
 *
 * Plain functions on purpose, not jest.fn(): see tests/mocks/resend.js.
 */
const posted = [];

class WebClient {
  constructor(token) {
    this.token = token;
    this.chat = {
      postMessage: async (message) => {
        posted.push(message);
        return { ok: true, ts: String(posted.length), channel: message && message.channel };
      },
    };
  }
}

const reset = () => {
  posted.length = 0;
};

module.exports = { WebClient, posted, reset };
