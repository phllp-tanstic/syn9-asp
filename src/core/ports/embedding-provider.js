import { NotImplementedError } from '../domain/errors.js';

/**
 * EmbeddingProvider — converts text into a dense vector for semantic
 * similarity search.
 *
 * Not one of the original six ports — added specifically because RECALL
 * cannot function without it. taskType distinguishes how WEAVE embeds a
 * claim (as a document to be found) from how RECALL embeds a query
 * (as a search intent) — asymmetric embedding, which meaningfully
 * improves retrieval quality over embedding both the same way.
 *
 * @interface
 */
export class EmbeddingProvider {
  /**
   * @param {{text: string, taskType: 'document'|'query'}} params
   * @returns {Promise<number[]>} dense vector
   */
  async embed(_params) {
    throw new NotImplementedError('EmbeddingProvider', 'embed');
  }
}