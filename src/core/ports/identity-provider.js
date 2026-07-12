import { NotImplementedError } from '../domain/errors.js';

/**
 * IdentityProvider — resolves an inbound request into an authenticated
 * agent identity, and registers new identities.
 *
 * v1 implementation (modules/identity/api-key-wallet-provider.js) trusts
 * an API key + X-Agent-Wallet header pair (see blueprint R2: wallet-native
 * signature verification is TEE-internal only as of this build). This
 * port exists so that v2 can swap in wallet-native signing without any
 * caller (routes, authorization) changing — they depend on this
 * interface, not on how identity is established.
 *
 * register() and authenticate() live on the same port deliberately:
 * issuing an identity and verifying one are two capabilities of the
 * same concern (identity), not two separate architectural boundaries.
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

  /**
   * Registers a new identity for a wallet address and issues an API key.
   * The raw key is returned exactly once — only its hash is persisted.
   * If the wallet address is already registered, implementations should
   * throw a ValidationError rather than silently issuing a second
   * identity for the same wallet.
   *
   * webhookUrl is optional — an identity with none set simply never
   * receives push notifications; the polling endpoint
   * (GET /v1/threads/:threadId/conflicts) remains the durable source of
   * truth regardless, since webhook delivery can fail silently
   * (wrong URL, receiver down, network blip) with no built-in way for
   * the caller to know.
   *
   * @param {{walletAddress: string, roles?: string[], webhookUrl?: string}} params
   * @returns {Promise<{identity: Identity, apiKey: string}>}
   */
  async register(_params) {
    throw new NotImplementedError('IdentityProvider', 'register');
  }
}

/**
 * @typedef {object} Identity
 * @property {string} identityId    - canonical, stable identifier for this agent
 * @property {string} walletAddress
 * @property {string[]} roles       - e.g. ['agent'], reserved for future role-based policy
 * @property {string|null} webhookUrl - optional push-notification target for conflict alerts
 */