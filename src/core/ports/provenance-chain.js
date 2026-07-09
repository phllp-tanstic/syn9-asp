import { NotImplementedError } from '../domain/errors.js';

/**
 * ProvenanceChain — computes the chain hash for a new claim and verifies
 * chain integrity on demand.
 *
 * This port is called unconditionally on every write. There is no
 * feature flag or opt-out — a Claim without a valid chain_hash is not a
 * Claim, per the blueprint's non-negotiable constraint #1. Isolating
 * this into its own module (rather than inlining a hash computation in
 * the write use case) means the hashing scheme can be upgraded (e.g.
 * to a different digest, or to include additional bound fields) with a
 * single-module change and a documented migration.
 *
 * @interface
 */
export class ProvenanceChain {
  /**
   * @param {{prevHash: string|null, claimId: string, payloadHash: string, timestamp: string, writerIdentityId: string}} params
   * @returns {string} chainHash, hex-encoded and prefixed (e.g. "0x...")
   */
  computeHash(_params) {
    throw new NotImplementedError('ProvenanceChain', 'computeHash');
  }

  /**
   * Recomputes the hash chain for an ordered list of claims and confirms
   * each link matches. Used for audit proofs and integrity checks.
   * @param {import('../domain/claim.js').Claim[]} orderedClaims
   * @returns {{valid: boolean, brokenAtClaimId: string|null}}
   */
  verifyChain(_orderedClaims) {
    throw new NotImplementedError('ProvenanceChain', 'verifyChain');
  }

  /** @returns {string} the SHA256 hash of a payload, used before chaining */
  hashPayload(_payload) {
    throw new NotImplementedError('ProvenanceChain', 'hashPayload');
  }
}