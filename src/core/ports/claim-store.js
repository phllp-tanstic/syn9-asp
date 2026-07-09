import { NotImplementedError } from '../domain/errors.js';

/**
 * ClaimStore — persistence boundary for Claims.
 *
 * No caller outside modules/storage should know this is Postgres +
 * pgvector. That is an implementation detail behind this interface,
 * which makes the storage engine replaceable (e.g. a different vector
 * index) without touching API routes or the write/read use cases.
 *
 * Note what this port does NOT expose: there is no `update()`. Claims
 * are append-only. The only mutation is `revoke()`, which sets a
 * revoked flag and timestamp — it never alters payload, hash, or chain
 * fields, since that would break provenance.
 *
 * @interface
 */
export class ClaimStore {
  /** @returns {Promise<import('../domain/claim.js').Claim>} */
  async append(_claim) {
    throw new NotImplementedError('ClaimStore', 'append');
  }

  /** @returns {Promise<import('../domain/claim.js').Claim|null>} */
  async getById(_claimId) {
    throw new NotImplementedError('ClaimStore', 'getById');
  }

  /**
   * Returns the most recent live (non-revoked) claim in a thread —
   * used to source prevHash for the next chain link.
   * @returns {Promise<import('../domain/claim.js').Claim|null>}
   */
  async getLatestInThread(_threadId) {
    throw new NotImplementedError('ClaimStore', 'getLatestInThread');
  }

  /**
   * Vector similarity search scoped to a thread, pre-authorization.
   * The caller (RECALL use case) is responsible for filtering results
   * through AuthorizationPolicy before returning anything to the client.
   * @param {{threadId: string, queryEmbedding: number[], topK: number, minSimilarity: number}} params
   * @returns {Promise<Array<{claim: import('../domain/claim.js').Claim, similarityScore: number}>>}
   */
  async searchBySimilarity(_params) {
    throw new NotImplementedError('ClaimStore', 'searchBySimilarity');
  }

  /** @returns {Promise<import('../domain/claim.js').Claim[]>} */
  async getRecentInThread(_threadId, _limit) {
    throw new NotImplementedError('ClaimStore', 'getRecentInThread');
  }

  /** @returns {Promise<{claimId: string, revokedAt: Date, chainHashFinal: string}>} */
  async revoke(_claimId) {
    throw new NotImplementedError('ClaimStore', 'revoke');
  }

  /** @returns {Promise<import('../domain/conflict.js').Conflict>} */
  async recordConflict(_conflict) {
    throw new NotImplementedError('ClaimStore', 'recordConflict');
  }
}