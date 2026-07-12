import { NotImplementedError } from '../domain/errors.js';

/**
 * AnomalyDetector — detects contradictions between a newly written
 * claim and recent claims in the same thread.
 *
 * Not one of the original six ports — added because WEAVE's anomaly
 * flagging (blueprint constraint #3: advisory, never blocking) needs
 * somewhere to live. Two-stage by design: implementations should
 * cheaply prefilter by embedding similarity before running an expensive
 * LLM contradiction check, per the blueprint's own architecture
 * (anomaly.js: "embedding similarity check first (cheap)... only run
 * LLM contradiction check if high similarity found (expensive)").
 *
 * @interface
 */
export class AnomalyDetector {
  /**
   * @param {{newClaim: import('../domain/claim.js').Claim, recentClaims: import('../domain/claim.js').Claim[]}} params
   * @returns {Promise<import('../domain/conflict.js').Conflict|null>} a
   *   Conflict if a contradiction was found, otherwise null. Does not
   *   persist the Conflict — callers are responsible for that via
   *   ClaimStore.recordConflict.
   */
  async detect(_params) {
    throw new NotImplementedError('AnomalyDetector', 'detect');
  }
}