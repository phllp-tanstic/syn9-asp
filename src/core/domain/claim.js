/**
 * Claim — the fundamental unit of state in Syn9.
 *
 * Deliberately not called "Entry", "Message", or "Memory". A Claim is an
 * assertion made by an identified agent, at a specific time, about the
 * state of a shared task — cryptographically bound into a provenance
 * chain and gated by an explicit authorization policy at read time.
 *
 * Claims are immutable once written. There is no update path. A later
 * Claim that contradicts an earlier one does not replace it — both
 * persist, and the contradiction is surfaced as a Conflict (see
 * conflict.js) linking the two. This is what "consensus-oriented
 * collaborative state" means in practice: Syn9 stores competing claims
 * with their provenance rather than picking a winner silently.
 */

export const PermissionMode = Object.freeze({
  EXPLICIT: 'explicit',     // allowlist of agent identities
  TASK_CHAIN: 'task_chain', // any identity participating in the same OKX task
  OPEN: 'open',             // any authenticated identity in the thread
});

export const ClaimScope = Object.freeze({
  WORKFLOW: 'workflow',     // expires when the originating task closes
  SESSION: 'session',       // expires after a fixed TTL (24h default)
  PERSISTENT: 'persistent', // no expiry; billed for storage past 48h
});

export class Claim {
  /**
   * @param {object} props
   * @param {string} props.claimId
   * @param {string} props.threadId
   * @param {string} props.writerIdentityId   - authenticated identity, not raw wallet string
   * @param {unknown} props.payload
   * @param {string} props.payloadHash
   * @param {{mode: string, allow?: string[], taskId?: string}} props.permission
   * @param {string} props.scope
   * @param {string} props.chainHash
   * @param {string|null} props.prevHash
   * @param {Date} props.createdAt
   * @param {Date|null} props.expiresAt
   * @param {boolean} [props.revoked]
   * @param {Date|null} [props.revokedAt]
   */
  constructor({
    claimId,
    threadId,
    writerIdentityId,
    payload,
    payloadHash,
    permission,
    scope,
    chainHash,
    prevHash,
    createdAt,
    expiresAt = null,
    revoked = false,
    revokedAt = null,
  }) {
    this.claimId = claimId;
    this.threadId = threadId;
    this.writerIdentityId = writerIdentityId;
    this.payload = payload;
    this.payloadHash = payloadHash;
    this.permission = Object.freeze({ ...permission });
    this.scope = scope;
    this.chainHash = chainHash;
    this.prevHash = prevHash;
    this.createdAt = createdAt;
    this.expiresAt = expiresAt;
    this.revoked = revoked;
    this.revokedAt = revokedAt;
  }

  isExpired(now = new Date()) {
    return Boolean(this.expiresAt) && this.expiresAt < now;
  }

  isLive(now = new Date()) {
    return !this.revoked && !this.isExpired(now);
  }
}