import { NotImplementedError } from '../domain/errors.js';

/**
 * AuthorizationPolicy — the single source of truth for "can this
 * identity access this claim, in this way, right now."
 *
 * Deliberately separated from IdentityProvider: identity answers "who is
 * this," authorization answers "what are they allowed to do." Keeping
 * them as distinct ports means role-based or delegated-access policies
 * (v2) can be introduced by replacing this module alone.
 *
 * @interface
 */
export class AuthorizationPolicy {
  /**
   * @param {{claim: import('../domain/claim.js').Claim, requesterIdentity: Identity, action: 'read'|'revoke'}} params
   * @returns {Promise<AuthorizationDecision>}
   */
  async evaluate(_params) {
    throw new NotImplementedError('AuthorizationPolicy', 'evaluate');
  }
}

/**
 * @typedef {object} AuthorizationDecision
 * @property {boolean} allowed
 * @property {string} [reason] - machine-readable reason code when denied
 *   (e.g. 'NOT_IN_ALLOWLIST', 'NOT_IN_TASK_CHAIN', 'REVOKED', 'EXPIRED')
 */