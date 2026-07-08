import { NotImplementedError } from '../domain/errors.js';

/**
 * IdentityProvider — resolves an inbound request into an authenticated
 * agent identity.
 *
 * v1 implementation (modules/identity/api-key-wallet-provider.js) trusts
 * an API key + X-Agent-Wallet header pair (see blueprint R2: wallet-native
 * signature verification is TEE-internal only as of this build). This
 * port exists so that v2 can swap in wallet-native signing without any
 * caller (routes, authorization) changing — they depend on this
 * interface, not on how identity is established.
 *
 * @interface
 */
export class IdentityProvider {
  /**
   * @param {{apiKey: string, walletAddress: string}} credentials
   * @returns {Promise<Identity>}
   * @throws {AuthenticationError} if credentials are invalid
   */
  async authenticate(_credentials) {
    throw new NotImplementedError('IdentityProvider', 'authenticate');
  }
}

/**
 * @typedef {object} Identity
 * @property {string} identityId    - canonical, stable identifier for this agent
 * @property {string} walletAddress
 * @property {string[]} roles       - e.g. ['agent'], reserved for future role-based policy
 */