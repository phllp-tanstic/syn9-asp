import { AuthorizationPolicy } from '../../core/ports/authorization-policy.js';
import { PermissionMode } from '../../core/domain/claim.js';

/**
 * PermissionModePolicy — concrete AuthorizationPolicy implementing the
 * three read-permission modes from the blueprint.
 *
 * KNOWN GAP: task_chain mode has no real enforcement yet — verifying
 * that a requester participates in the same OKX task requires the OKX
 * task membership API, which is Day 5 scope. Denying by default (rather
 * than allowing, or silently falling back to explicit with no allowlist
 * to check) is the safer failure mode for a system whose entire premise
 * is permission-gated access — a trust layer that fails open on an
 * unimplemented check is worse than one that fails closed.
 */
export class PermissionModePolicy extends AuthorizationPolicy {
  async evaluate({ claim, requesterIdentity, action }) {
    if (claim.revoked) {
      return { allowed: false, reason: 'REVOKED' };
    }
    if (claim.isExpired()) {
      return { allowed: false, reason: 'EXPIRED' };
    }

    if (action !== 'read') {
      // revoke has its own writer-identity check in api/routes/revoke.js,
      // deliberately not routed through this policy — see that file's
      // header comment for why.
      return { allowed: false, reason: 'UNSUPPORTED_ACTION' };
    }

    switch (claim.permission.mode) {
      case PermissionMode.OPEN:
        return { allowed: true };

      case PermissionMode.EXPLICIT:
        return {
          allowed: (claim.permission.allow ?? []).includes(
            requesterIdentity.walletAddress
          ),
          reason: 'NOT_IN_ALLOWLIST',
        };

      case PermissionMode.TASK_CHAIN:
        // Not implemented — see class-level comment. Deny by default.
        return { allowed: false, reason: 'TASK_CHAIN_NOT_IMPLEMENTED' };

      default:
        return { allowed: false, reason: 'UNKNOWN_PERMISSION_MODE' };
    }
  }
}