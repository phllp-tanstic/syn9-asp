import { ValidationError } from '../../core/domain/errors.js';

/**
 * Identity registration route.
 *
 * Deliberately outside the auth middleware — an agent has no API key
 * yet at the point it's requesting one. Returns the raw API key exactly
 * once; it cannot be recovered after this response, only rotated (not
 * yet implemented — no rotation endpoint exists as of Day 2).
 *
 * Rate-limited to 5 registrations per hour per caller — this is the one
 * endpoint with no auth gate at all (can't require an API key to get an
 * API key), making it the highest-risk target for spam registration.
 *
 * @param {import('fastify').FastifyInstance} fastify
 * @param {{identityProvider: import('../../core/ports/identity-provider.js').IdentityProvider}} opts
 */
export default async function identitiesRoutes(fastify, opts) {
  const { identityProvider } = opts;

  fastify.post(
    '/v1/identities',
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '1 hour',
        },
      },
    },
    async (request, reply) => {
      const { walletAddress, roles, webhook_url: webhookUrl } = request.body ?? {};

      if (!walletAddress || typeof walletAddress !== 'string') {
        throw new ValidationError('walletAddress is required', {
          details: { field: 'walletAddress' },
        });
      }

      if (webhookUrl !== undefined && typeof webhookUrl !== 'string') {
        throw new ValidationError('webhook_url must be a string if provided');
      }

      const { identity, apiKey } = await identityProvider.register({
        walletAddress,
        roles,
        webhookUrl: webhookUrl ?? null,
      });

      reply.code(201);
      return {
        identityId: identity.identityId,
        walletAddress: identity.walletAddress,
        roles: identity.roles,
        webhook_url: identity.webhookUrl,
        apiKey, // shown exactly once — store this now, it cannot be retrieved again
      };
    }
  );
}