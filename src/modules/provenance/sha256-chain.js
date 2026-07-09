import { createHash } from 'node:crypto';
import { ProvenanceChain } from '../../core/ports/provenance-chain.js';
import { ChainIntegrityError } from '../../core/domain/errors.js';

const ZERO_HASH =
  '0x0000000000000000000000000000000000000000000000000000000000000000';

/**
 * Sha256Chain — concrete ProvenanceChain implementation.
 *
 * Algorithm matches the blueprint exactly:
 *   chainHash = SHA256(prevHash | claimId | payloadHash | timestamp | writerIdentityId)
 * fields joined with '|', prevHash defaults to the zero hash for the
 * first claim in a thread.
 *
 * This is the only file in the codebase that should import node:crypto
 * for hashing — every other module depends on the ProvenanceChain port,
 * not on a specific digest algorithm. Upgrading the hash function later
 * (e.g. to a different digest) is a single-file change here.
 */
export class Sha256Chain extends ProvenanceChain {
  computeHash({ prevHash, claimId, payloadHash, timestamp, writerIdentityId }) {
    const input = [
      prevHash ?? ZERO_HASH,
      claimId,
      payloadHash,
      timestamp,
      writerIdentityId,
    ].join('|');

    return '0x' + createHash('sha256').update(input).digest('hex');
  }

  hashPayload(payload) {
    const serialized =
      typeof payload === 'string' ? payload : JSON.stringify(payload);
    return createHash('sha256').update(serialized).digest('hex');
  }

  /**
   * Recomputes each link in an ordered list of claims (oldest first) and
   * confirms it matches the stored chainHash — detects tampering with
   * any historical claim, since altering one breaks every hash after it.
   */
  verifyChain(orderedClaims) {
    let expectedPrevHash = null;

    for (const claim of orderedClaims) {
      if (claim.prevHash !== expectedPrevHash) {
        return { valid: false, brokenAtClaimId: claim.claimId };
      }

      const recomputed = this.computeHash({
        prevHash: claim.prevHash,
        claimId: claim.claimId,
        payloadHash: claim.payloadHash,
        timestamp: claim.createdAt.toISOString(),
        writerIdentityId: claim.writerIdentityId,
      });

      if (recomputed !== claim.chainHash) {
        return { valid: false, brokenAtClaimId: claim.claimId };
      }

      expectedPrevHash = claim.chainHash;
    }

    return { valid: true, brokenAtClaimId: null };
  }

  /** Throws instead of returning a result — used where a caller wants a
   *  hard failure rather than a boolean, e.g. a future audit-proof CLI. */
  assertValid(orderedClaims) {
    const result = this.verifyChain(orderedClaims);
    if (!result.valid) {
      throw new ChainIntegrityError(
        `Chain integrity check failed at claim ${result.brokenAtClaimId}`
      );
    }
  }
}