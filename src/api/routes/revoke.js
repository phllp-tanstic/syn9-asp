import { NotFoundError, PermissionDeniedError } from '../../core/domain/errors.js';
import { requireAuth } from '../middleware/auth.js';

/**
 * REVOKE — immediate expiry.
 *
 * Per the blueprint: only the original writer (X-Agent-Wallet must
 * match) can revoke a claim. This is a writer-identity check, not a
 * read-permission decision — deliberately not routed through
 * AuthorizationPolicy, which governs who can *read* a claim under its
 * permission mode (explicit/task_chain/open), a different question
 * from "did you write this."
 *
 * @param {import('fastify').FastifyInstance} fastify
 * @param {{claimStore: import('../../core/ports/claim-store.js').ClaimStore,
 *          identityProvider: import('../../core/ports/identity-provider.js').IdentityProvider}} opts
 */
export default async function revokeRoutes(fastify, opts) {
  const { claimStore, identityProvider } = opts;

  fastify.delete(
    '/v1/threads/:threadId/entries/:entryId',
    { preHandler: requireAuth(identityProvider) },
    async (request) => {
      const { entryId } = request.params;

      const claim = await claimStore.getById(entryId);
      if (!claim) {
        throw new NotFoundError(`Claim ${entryId} not found`);
      }

      if (claim.writerIdentityId !== request.identity.identityId) {
        throw new PermissionDeniedError(
          'Only the original writer may revoke this claim',
          { entryExists: true, reason: 'NOT_WRITER' }
        );
      }

      const result = await claimStore.revoke(entryId);

      return {
        revoked: true,
        entry_id: result.claimId,
        revoked_at: result.revokedAt.toISOString(),
        chain_hash_final: result.chainHashFinal,
      };
    }
  );
}