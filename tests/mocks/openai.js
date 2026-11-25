/**
 * Stand-in for the "openai" package during tests (moduleNameMapper in
 * jest.config.js). No request is made. Every request the code tries to make is
 * kept in `requests`, and the reply is whatever the test put in `nextReply`
 * (an empty assistant message by default):
 *
 *   const openai = require('openai');
 *   openai.nextReply.content = '{"score": 7}';
 *
 * Plain functions on purpose, not jest.fn(): see tests/mocks/resend.js.
 */
const requests = [];
const nextReply = { content: '' };

class OpenAI {
  constructor(options) {
    this.options = options;
    this.chat = {
      completions: {
        create: async (request) => {
          requests.push(request);
          return {
            id: `test-completion-${requests.length}`,
            choices: [{ index: 0, message: { role: 'assistant', content: nextReply.content }, finish_reason: 'stop' }],
          };
        },
      },
    };
  }
}

const reset = () => {
  requests.length = 0;
  nextReply.content = '';
};

module.exports = OpenAI;
module.exports.OpenAI = OpenAI;
module.exports.default = OpenAI;
module.exports.requests = requests;
module.exports.nextReply = nextReply;
module.exports.reset = reset;
