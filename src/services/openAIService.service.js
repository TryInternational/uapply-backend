const OpenAI = require('openai');
const config = require('../config/config');

const openai = new OpenAI({
  apiKey: config.openai.apiKey,
});

/**
 * Evaluate writing using OpenAI
 * @param {string} prompt - The evaluation prompt
 * @returns {Promise<Object>} - The evaluation result
 */
const evaluateWriting = async (prompt) => {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content:
            'You are an expert IELTS examiner with years of experience evaluating writing tasks. Provide detailed, constructive feedback following official IELTS criteria.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' },
      max_tokens: 1500,
    });

    return JSON.parse(response.choices[0].message.content);
  } catch (error) {
    console.error('OpenAI API Error:', error);
    throw error;
  }
};

module.exports = {
  evaluateWriting,
};
