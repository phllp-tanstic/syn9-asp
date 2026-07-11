import { config } from '../../config/index.js';

const API_BASE = 'https://api.groq.com/openai/v1';

/**
 * Thin shared wrapper around Groq's OpenAI-compatible chat completions
 * endpoint.
 *
 * Not a port — an internal utility used by both
 * modules/synthesis/groq-synthesis-engine.js and
 * modules/anomaly/groq-anomaly-detector.js. See config/index.js for why
 * Groq specifically (data retention policy) rather than reusing the
 * Gemini key already configured for embeddings.
 */
export async function generateText({
  prompt,
  systemInstruction,
  apiKey = config.synthesis.groqApiKey,
  model = config.synthesis.model,
}) {
  if (!apiKey) {
    throw new Error('GROQ_API_KEY is not set. Cannot call Groq chat completions.');
  }

  const messages = [];
  if (systemInstruction) {
    messages.push({ role: 'system', content: systemInstruction });
  }
  messages.push({ role: 'user', content: prompt });

  const response = await fetch(`${API_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Groq chat completions failed (${response.status}): ${errorBody}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (text === undefined) {
    throw new Error(`Groq response had no message content: ${JSON.stringify(data)}`);
  }
  return text;
}