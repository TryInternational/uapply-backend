/**
 * Stand-in for the "resend" package during tests (moduleNameMapper in
 * jest.config.js). Nothing is sent. Every message the code tries to send is
 * kept in `sent`, so a test can check what would have gone out:
 *
 *   const { sent } = require('resend');
 *   expect(sent).toHaveLength(1);
 *
 * Plain functions on purpose, not jest.fn(): jest.config.js sets restoreMocks,
 * which would strip a jest.fn() of its behaviour after the first test.
 */
const sent = [];

class Resend {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.emails = {
      send: async (message) => {
        sent.push(message);
        return { data: { id: `test-email-${sent.length}` }, error: null };
      },
    };
  }
}

const reset = () => {
  sent.length = 0;
};

module.exports = { Resend, sent, reset };
