import { AuthorizationPolicy } from '../../core/ports/authorization-policy.js';
import { PermissionMode } from '../../core/domain/claim.js';

/**
 * PermissionModePolicy — concrete AuthorizationPolicy.
 *
 * explicit mode now checks the union of a claim's original
 * permission.allow list AND any wallets granted access afterward via
 * PERMISSION_GRANT (permission_grants table) — grants are additive,
 * never replace the original allowlist, and are themselves an
 * auditable append-only record (see migration 006).
 *
 * KNOWN GAP: task_chain mode has no real enforcement — verifying task
 * membership requires an OKX task-membership API that isn't
 * server-callable for arbitrary third-party wallets (confirmed via
 * research, not assumed). Denying by default is the safer failure mode
 * for a system whose entire premise is permission-gated access.
 */
export class PermissionModePolicy extends AuthorizationPolicy {
  /** @param {import('../../core/ports/claim-store.js').ClaimStore} claimStore */
  constructor(claimStore) {
    super();
    this.claimStore = claimStore;
  }

  async evaluate({ claim, requesterIdentity, action }) {
    if (claim.revoked) {
      return { allowed: false, reason: 'REVOKED' };
    }
    if (claim.isExpired()) {
      return { allowed: false, reason: 'EXPIRED' };
    }

    if (action !== 'read') {
      return { allowed: false, reason: 'UNSUPPORTED_ACTION' };
    }

    switch (claim.permission.mode) {
      case PermissionMode.OPEN:
        return { allowed: true };

      case PermissionMode.EXPLICIT: {
        const originalAllow = claim.permission.allow ?? [];
        const grantedWallets = await this.claimStore.getGrantedWallets(claim.claimId);
        const allAllowed = new Set([...originalAllow, ...grantedWallets]);
        return {
          allowed: allAllowed.has(requesterIdentity.walletAddress),
          reason: 'NOT_IN_ALLOWLIST',
        };
      }

      case PermissionMode.TASK_CHAIN:
        return { allowed: false, reason: 'TASK_CHAIN_NOT_IMPLEMENTED' };

      default:
        return { allowed: false, reason: 'UNKNOWN_PERMISSION_MODE' };
    }
  }
}