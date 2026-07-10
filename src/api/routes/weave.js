import { generateId } from '../../core/domain/id.js';
import { Claim, PermissionMode, ClaimScope } from '../../core/domain/claim.js';
import { ValidationError } from '../../core/domain/errors.js';
import { requireAuth } from '../middleware/auth.js';

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_PAYLOAD_BYTES = 32 * 1024; // 32KB, per blueprint

/**
 * WEAVE — write with provenance.
 *
 * Known gaps as of Day 2 (flagged, not silent):
 *  - embeddings not implemented; claims are stored with embedding=null.
 *    RECALL's similarity search depends on this landing (Day 3).
 *  - anomaly detection not implemented; anomaly_flag is always null.
 *    Async detection is Day 4 scope per the blueprint.
 *  - workflow-scope expiry (tied to task close) isn't enforced yet;
 *    workflow claims get expiresAt=null until task-chain awareness
 *    lands (Day 5). session scope's 24h TTL is computed immediately
 *    since it needs no task tracking.
 *
 * @param {import('fastify').FastifyInstance} fastify
 * @param {{claimStore: import('../../core/ports/claim-store.js').ClaimStore,
 *          provenanceChain: import('../../core/ports/provenance-chain.js').ProvenanceChain,
 *          identityProvider: import('../../core/ports/identity-provider.js').IdentityProvider}} opts
 */
export default async function weaveRoutes(fastify, opts) {
  const { claimStore, provenanceChain, identityProvider } = opts;

  fastify.post(
    '/v1/threads/:threadId/weave',
    { preHandler: requireAuth(identityProvider) },
    async (request, reply) => {
      const { threadId } = request.params;
      const {
        payload,
        permissions,
        scope,
        task_id: taskId,
      } = request.body ?? {};

      if (payload === undefined || payload === null) {
        throw new ValidationError('payload is required');
      }

      const payloadSize = Buffer.byteLength(JSON.stringify(payload), 'utf8');
      if (payloadSize > MAX_PAYLOAD_BYTES) {
        throw new ValidationError(
          `payload exceeds max size of ${MAX_PAYLOAD_BYTES} bytes`,
          { details: { payloadSize, maxBytes: MAX_PAYLOAD_BYTES } }
        );
      }

      if (!permissions || !Object.values(PermissionMode).includes(permissions.mode)) {
        throw new ValidationError(
          `permissions.mode is required and must be one of: ${Object.values(PermissionMode).join(', ')}`
        );
      }

      if (permissions.mode === PermissionMode.TASK_CHAIN && !taskId) {
        throw new ValidationError(
          'task_id is required when permissions.mode is task_chain'
        );
      }

      if (!Object.values(ClaimScope).includes(scope)) {
        throw new ValidationError(
          `scope is required and must be one of: ${Object.values(ClaimScope).join(', ')}`
        );
      }

      const writerIdentityId = request.identity.identityId;
      const claimId = generateId('syn9_claim');
      const payloadHash = provenanceChain.hashPayload(payload);
      const timestamp = new Date();

      const latestClaim = await claimStore.getLatestInThread(threadId);
      const prevHash = latestClaim ? latestClaim.chainHash : null;

      const chainHash = provenanceChain.computeHash({
        prevHash,
        claimId,
        payloadHash,
        timestamp: timestamp.toISOString(),
        writerIdentityId,
      });

      let expiresAt = null;
      if (scope === ClaimScope.SESSION) {
        expiresAt = new Date(timestamp.getTime() + SESSION_TTL_MS);
      }
      // workflow scope: expiresAt stays null until task-chain-aware
      // expiry lands (Day 5) — see gap note above.

      const claim = new Claim({
        claimId,
        threadId,
        writerIdentityId,
        payload,
        payloadHash,
        permission: {
          mode: permissions.mode,
          allow: permissions.allow,
          taskId: permissions.mode === PermissionMode.TASK_CHAIN ? taskId : undefined,
        },
        scope,
        chainHash,
        prevHash,
        createdAt: timestamp,
        expiresAt,
      });

      const stored = await claimStore.append(claim);

      reply.code(201);
      return {
        entry_id: stored.claimId,
        chain_hash: stored.chainHash,
        timestamp: stored.createdAt.toISOString(),
        anomaly_flag: null, // async anomaly detection not implemented yet (Day 4)
      };
    }
  );
}