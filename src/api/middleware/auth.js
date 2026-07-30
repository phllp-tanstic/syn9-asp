import { AuthenticationError } from '../../core/domain/errors.js';

export function requireAuth(identityProvider) {
  return async function authPreHandler(request) {
    const authHeader = request.headers['authorization'];
    const walletAddress = request.headers['x-agent-wallet'];

    // If identity already set by payment middleware AND no Bearer token
    // is present, accept the payment-derived identity as-is.
    // If a Bearer token IS present, authenticate with it so the
    // registered Syn9 identity (not the x402 payer wallet) is used.
    if (request.identity && (!authHeader || !authHeader.startsWith('Bearer '))) {
      return;
    }

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AuthenticationError(
        'Missing or malformed Authorization header (expected: Bearer {apiKey})'
      );
    }

    const apiKey = authHeader.slice('Bearer '.length).trim();

    if (!walletAddress || typeof walletAddress !== 'string') {
      throw new AuthenticationError('Missing X-Agent-Wallet header');
    }

    const identity = await identityProvider.authenticate({
      apiKey,
      walletAddress,
    });
    request.identity = identity;
  };
}
