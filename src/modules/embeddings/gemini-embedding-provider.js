import { EmbeddingProvider } from '../../core/ports/embedding-provider.js';
import { config } from '../../config/index.js';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * GeminiEmbeddingProvider — concrete EmbeddingProvider using Google's
 * gemini-embedding-001 model via plain REST (no SDK dependency, kept
 * consistent with minimizing deps elsewhere in this codebase).
 *
 * Output dimensionality fixed at 1536 to match the schema's original
 * VECTOR(1536) column (set for OpenAI in the blueprint) — avoids a
 * migration. Gemini only pre-normalizes at the full 3072-dim output;
 * at 1536 vectors are unnormalized. This is safe here because
 * pgvector's <=> cosine-distance operator is normalization-invariant
 * by definition (cosine similarity divides by vector magnitude
 * internally) — normalization would only matter if we used dot-product
 * or Euclidean comparisons instead.
 *
 * taskType maps to Gemini's task_type parameter: 'document' ->
 * RETRIEVAL_DOCUMENT (used by WEAVE, embedding a claim to be found),
 * 'query' -> RETRIEVAL_QUERY (used by RECALL, embedding a search
 * intent). Asymmetric embedding — document and query text embedded
 * with different task hints — improves retrieval quality over
 * embedding both identically.
 */
export class GeminiEmbeddingProvider extends EmbeddingProvider {
  constructor({ apiKey = config.embeddings.geminiApiKey, model = config.embeddings.model } = {}) {
    super();
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not set. Cannot initialize GeminiEmbeddingProvider.');
    }
    this.apiKey = apiKey;
    this.model = model;
  }

  async embed({ text, taskType }) {
    const geminiTaskType =
      taskType === 'document' ? 'RETRIEVAL_DOCUMENT' : 'RETRIEVAL_QUERY';

    const response = await fetch(
      `${API_BASE}/models/${this.model}:embedContent?key=${this.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: { parts: [{ text }] },
          taskType: geminiTaskType,
          outputDimensionality: 1536,
        }),
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Gemini embedding request failed (${response.status}): ${errorBody}`
      );
    }

    const data = await response.json();
    return data.embedding.values;
  }
}