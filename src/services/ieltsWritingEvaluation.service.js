/**
 * IELTS AI writing evaluation — backend service for
 * POST /v1/ielts-tests/evaluate-writing (frontend constant IELTS_EVALUATE_WRITING).
 *
 * Ported from ulearn-abroad/server/ielts-evaluate-writing.js (which only runs
 * inside the CRA dev server via setupProxy.js) so staging/production get the
 * same scorer. PROVIDER-AGNOSTIC: uses whichever key is configured —
 *   ANTHROPIC_API_KEY  → Claude (preferred when both are set)
 *   OPENAI_API_KEY     → OpenAI
 *   IELTS_SCORING_MODEL → optional model override for either provider
 *
 * Rubric fidelity: the system prompt embeds the assessment structure of the
 * official public Writing band descriptors (British Council, May 2023).
 * Criteria per ielts.org (equal weighting, Task 2 double weight overall).
 * The frontend recomputes task/section bands from the criterion scores —
 * this service validates and clamps but never trusts model arithmetic.
 */
const { default: axios } = require('axios');
const config = require('../config/config');

// Model fallback chains: later entries cover keys without access to newer
// models (fall through on 404/403 model-availability errors only).
const OPENAI_MODELS = [config.ieltsScoring.model, 'gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo'].filter(Boolean);
const ANTHROPIC_MODELS = [
  config.ieltsScoring.model,
  'claude-sonnet-4-5',
  'claude-3-7-sonnet-latest',
  'claude-3-5-haiku-latest',
].filter(Boolean);

const BAND_DESCRIPTOR_RUBRIC = `
You are an IELTS examiner. Score STRICTLY per the official public Writing band
descriptors (British Council, May 2023). Award each criterion a WHOLE or HALF
band from 0 to 9. Anchor phrases:

TASK ACHIEVEMENT (T1) / TASK RESPONSE (T2):
 9 fully addresses all parts of the task
 8 well-developed response; relevant, extended and supported ideas
 7 clear position throughout the response
 6 position present but conclusions may become unclear or repetitive
 5 addresses the task only partially
 4 responds to the task only in a minimal way

COHERENCE AND COHESION:
 9 cohesion attracts no attention
 8 manages all aspects of cohesion well
 7 clear progression throughout
 6 cohesion may be faulty or mechanical
 5 lack of overall progression
 4 not arranged coherently; no clear progression

LEXICAL RESOURCE:
 9 rare minor errors occur only as slips
 8 occasional inaccuracies in word choice and collocation
 7 sufficient range to allow flexibility and precision
 6 adequate range for the task
 5 limited range, minimally adequate
 4 basic vocabulary used repetitively

GRAMMATICAL RANGE AND ACCURACY:
 9 full flexibility and accuracy; rare minor slips
 8 majority of sentences are error-free
 7 frequent error-free sentences
 6 errors rarely reduce communication
 5 frequent grammatical errors
 4 errors predominate

Under-length answers (T1 < 150 words, T2 < 250 words) are penalised in Task
Achievement / Task Response. A blank or off-topic answer scores 0-2 on that
task. Be strict: do not inflate. Respond with ONLY the JSON object matching
the responseSchema in the user message — no prose, no markdown fences.`;

const HALF = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(9, Math.max(0, Math.round(n * 2) / 2));
};

const sanitizeTask = (raw, firstCriterion) => {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  const keys = [firstCriterion, 'coherenceCohesion', 'lexicalResource', 'grammaticalRange'];
  for (let i = 0; i < keys.length; i += 1) {
    out[keys[i]] = HALF(raw[keys[i]]);
    if (out[keys[i]] === null) return null;
  }
  out.feedback = String(raw.feedback || '').slice(0, 2000);
  out.strengths = Array.isArray(raw.strengths) ? raw.strengths.slice(0, 6).map(String) : [];
  out.weaknesses = Array.isArray(raw.weaknesses) ? raw.weaknesses.slice(0, 6).map(String) : [];
  out.recommendations = Array.isArray(raw.recommendations) ? raw.recommendations.slice(0, 6).map(String) : [];
  return out;
};

/** Pull the JSON object out of a model reply (tolerates markdown fences). */
const extractJson = (text) => {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('no JSON in model output');
  return JSON.parse(text.slice(start, end + 1));
};

const isModelAvailabilityError = (err) => {
  const status = err.response && err.response.status;
  return status === 404 || status === 403;
};

async function callOpenAI(userPrompt) {
  let lastError;
  for (const model of OPENAI_MODELS) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const resp = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model,
          messages: [
            { role: 'system', content: BAND_DESCRIPTOR_RUBRIC },
            { role: 'user', content: userPrompt },
          ],
          response_format: { type: 'json_object' },
          temperature: 0,
          max_tokens: 1800,
        },
        {
          headers: {
            Authorization: `Bearer ${config.openai.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 45000,
        }
      );
      console.log(`evaluate-writing: scored with OpenAI "${model}"`);
      return resp.data.choices[0].message.content;
    } catch (err) {
      lastError = err;
      console.error(
        `evaluate-writing: OpenAI "${model}" failed (${err.response?.status || err.code}): ${
          err.response?.data?.error?.message || err.message
        }`
      );
      if (!isModelAvailabilityError(err)) throw err;
    }
  }
  throw lastError;
}

async function callAnthropic(userPrompt) {
  let lastError;
  for (const model of ANTHROPIC_MODELS) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const resp = await axios.post(
        'https://api.anthropic.com/v1/messages',
        {
          model,
          max_tokens: 1800,
          temperature: 0,
          system: BAND_DESCRIPTOR_RUBRIC,
          messages: [{ role: 'user', content: userPrompt }],
        },
        {
          headers: {
            'x-api-key': config.anthropic.apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
          },
          timeout: 45000,
        }
      );
      console.log(`evaluate-writing: scored with Anthropic "${model}"`);
      return (resp.data.content || []).map((c) => c.text || '').join('');
    } catch (err) {
      lastError = err;
      console.error(
        `evaluate-writing: Anthropic "${model}" failed (${err.response?.status || err.code}): ${
          err.response?.data?.error?.message || err.message
        }`
      );
      if (!isModelAvailabilityError(err)) throw err;
    }
  }
  throw lastError;
}

const isConfigured = () => Boolean(config.anthropic.apiKey || config.openai.apiKey);

/**
 * Evaluate both writing tasks with the configured AI provider.
 * @param {Object} body - { module, task1: {prompt, answer}, task2: {prompt, answer} }
 * @returns {Promise<{task1: Object, task2: Object, summary: string}|null>}
 *          null when the model output failed validation (caller → 502)
 * @throws upstream axios errors (caller maps 429 / scoring_failed)
 */
const evaluateWriting = async (body) => {
  const { module: testModule = 'Academic', task1 = {}, task2 = {} } = body || {};

  const userPrompt = JSON.stringify({
    module: testModule,
    task1: { prompt: String(task1.prompt || '').slice(0, 4000), answer: String(task1.answer || '').slice(0, 12000) },
    task2: { prompt: String(task2.prompt || '').slice(0, 4000), answer: String(task2.answer || '').slice(0, 12000) },
    responseSchema: {
      task1: {
        taskAchievement: 0,
        coherenceCohesion: 0,
        lexicalResource: 0,
        grammaticalRange: 0,
        feedback: '',
        strengths: [],
        weaknesses: [],
        recommendations: [],
      },
      task2: {
        taskResponse: 0,
        coherenceCohesion: 0,
        lexicalResource: 0,
        grammaticalRange: 0,
        feedback: '',
        strengths: [],
        weaknesses: [],
        recommendations: [],
      },
      summary: '',
    },
  });

  // Claude preferred when both keys are configured
  const rawText = config.anthropic.apiKey ? await callAnthropic(userPrompt) : await callOpenAI(userPrompt);

  let parsed;
  try {
    parsed = extractJson(rawText);
  } catch (err) {
    return null; // unparseable model output → caller responds 502 invalid_model_output
  }
  const t1 = sanitizeTask(parsed.task1, 'taskAchievement');
  const t2 = sanitizeTask(parsed.task2, 'taskResponse');
  if (!t1 || !t2) return null;

  return { task1: t1, task2: t2, summary: String(parsed.summary || '').slice(0, 3000) };
};

module.exports = {
  isConfigured,
  evaluateWriting,
};
