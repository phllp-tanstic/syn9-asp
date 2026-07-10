import { AuthenticationError } from '../../core/domain/errors.js';

/**
 * Auth preHandler factory — extracts `Authorization: Bearer {key}` and
 * `X-Agent-Wallet`, resolves them to an Identity via the injected
 * IdentityProvider, and attaches it to `request.identity`.
 *
 * Applied per-route (via { preHandler: requireAuth(identityProvider) }
 * in each route's options), not globally — /v1/health and
 * /v1/identities must stay reachable without credentials. WEAVE,
 * RECALL, and REVOKE all register this same hook rather than each
 * re-implementing credential extraction.
 *
 * @param {import('../../core/ports/identity-provider.js').IdentityProvider} identityProvider
 */
export function requireAuth(identityProvider) {
  return async function authPreHandler(request) {
    const authHeader = request.headers['authorization'];
    const walletAddress = request.headers['x-agent-wallet'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AuthenticationError(
        'Missing or malformed Authorization header (expected: Bearer {apiKey})'
      );
    }

    const apiKey = authHeader.slice('Bearer '.length).trim();

    if (!walletAddress || typeof walletAddress !== 'string') {
      throw new AuthenticationError('Missing X-Agent-Wallet header');
    }

    // Let AuthenticationError propagate as-is — the error handler in
    // server.js already maps it to 401 with no further translation needed.
    const identity = await identityProvider.authenticate({
      apiKey,
      walletAddress,
    });

    request.identity = identity;
  };
}