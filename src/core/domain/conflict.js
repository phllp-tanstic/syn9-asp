/**
 * Conflict — a detected contradiction between two live Claims.
 *
 * Syn9 never resolves conflicts by overwriting. A Conflict record links
 * the incoming Claim to the prior Claim it contradicts, with a
 * similarity score and a summary of the contradiction. Both Claims
 * remain independently readable and independently permissioned.
 *
 * This entity is intentionally thin today (v1: advisory flag surfaced
 * on write, never blocking). It exists as its own domain type — rather
 * than an inline field on Claim — so that v2 consensus/confidence
 * scoring and resolution workflows have a stable place to attach to
 * without reshaping Claim itself.
 */

export const ConflictStatus = Object.freeze({
  OPEN: 'open',                 // detected, unresolved, both claims stand
  ACKNOWLEDGED: 'acknowledged', // a consumer has seen it (future: via API)
  RESOLVED: 'resolved',         // future: consensus/resolution workflow landed on an outcome
});

export class Conflict {
  /**
   * @param {object} props
   * @param {string} props.conflictId
   * @param {string} props.threadId
   * @param {string} props.claimId               - the newer, incoming claim
   * @param {string} props.conflictsWithClaimId   - the prior claim it contradicts
   * @param {number} props.similarityScore
   * @param {string} props.summary
   * @param {string} [props.status]
   * @param {Date} props.detectedAt
   */
  constructor({
    conflictId,
    threadId,
    claimId,
    conflictsWithClaimId,
    similarityScore,
    summary,
    status = ConflictStatus.OPEN,
    detectedAt,
  }) {
    this.conflictId = conflictId;
    this.threadId = threadId;
    this.claimId = claimId;
    this.conflictsWithClaimId = conflictsWithClaimId;
    this.similarityScore = similarityScore;
    this.summary = summary;
    this.status = status;
    this.detectedAt = detectedAt;
  }
}