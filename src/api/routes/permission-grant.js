import { NotFoundError, PermissionDeniedError, ValidationError } from '../../core/domain/errors.js';
import { generateId } from '../../core/domain/id.js';
import { requireAuth } from '../middleware/auth.js';

/**
 * PERMISSION_GRANT — mid-workflow allowlist addition.
 *
 * Only the original writer of a claim may grant access to it — same
 * writer-identity check as REVOKE, deliberately not routed through
 * AuthorizationPolicy (which governs read permission, a different
 * question from "can you modify this claim's access policy").
 *
 * Grants are additive and permanent for the life of the claim — no
 * corresponding "revoke a grant" endpoint exists yet. That's a real,
 * flagged gap: production use would likely need this, but it wasn't
 * in the blueprint's original spec and is deferred, not silently
 * dropped.
 *
 * @param {import('fastify').FastifyInstance} fastify
 * @param {{claimStore, identityProvider}} opts
 */
export default async function permissionGrantRoutes(fastify, opts) {
  const { claimStore, identityProvider } = opts;

  fastify.post(
    '/v1/threads/:threadId/entries/:entryId/grant',
    { preHandler: requireAuth(identityProvider) },
    async (request, reply) => {
      const { entryId } = request.params;
      const { wallet } = request.body ?? {};

      if (!wallet || typeof wallet !== 'string') {
        throw new ValidationError('wallet is required', {
          details: { field: 'wallet' },
        });
      }

      const claim = await claimStore.getById(entryId);
      if (!claim) {
        throw new NotFoundError(`Claim ${entryId} not found`);
      }

      if (claim.writerIdentityId !== request.identity.identityId) {
        throw new PermissionDeniedError(
          'Only the original writer may grant access to this claim',
          { entryExists: true, reason: 'NOT_WRITER' }
        );
      }

      const grantId = generateId('syn9_grant');
      await claimStore.recordGrant({
        grantId,
        claimId: entryId,
        grantedToWallet: wallet,
        grantedByIdentityId: request.identity.identityId,
      });

      reply.code(201);
      return {
        granted: true,
        grant_id: grantId,
        entry_id: entryId,
        granted_to_wallet: wallet,
      };
    }
  );
}