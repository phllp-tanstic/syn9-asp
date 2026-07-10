import { ValidationError } from '../../core/domain/errors.js';

/**
 * Identity registration route.
 *
 * Deliberately outside the auth middleware — an agent has no API key
 * yet at the point it's requesting one. Returns the raw API key exactly
 * once; it cannot be recovered after this response, only rotated (not
 * yet implemented — no rotation endpoint exists as of Day 2).
 *
 * @param {import('fastify').FastifyInstance} fastify
 * @param {{identityProvider: import('../../core/ports/identity-provider.js').IdentityProvider}} opts
 */
export default async function identitiesRoutes(fastify, opts) {
  const { identityProvider } = opts;

  fastify.post('/v1/identities', async (request, reply) => {
    const { walletAddress, roles } = request.body ?? {};

    if (!walletAddress || typeof walletAddress !== 'string') {
      throw new ValidationError('walletAddress is required', {
        details: { field: 'walletAddress' },
      });
    }

    const { identity, apiKey } = await identityProvider.register({
      walletAddress,
      roles,
    });

    reply.code(201);
    return {
      identityId: identity.identityId,
      walletAddress: identity.walletAddress,
      roles: identity.roles,
      apiKey, // shown exactly once — store this now, it cannot be retrieved again
    };
  });
}