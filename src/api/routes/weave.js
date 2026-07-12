import { generateId } from '../../core/domain/id.js';
import { Claim, ClaimScope } from '../../core/domain/claim.js';
import { ValidationError } from '../../core/domain/errors.js';
import { validatePermission } from '../../core/domain/validate-permission.js';
import { requireAuth } from '../middleware/auth.js';

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const WORKFLOW_FALLBACK_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_PAYLOAD_BYTES = 32 * 1024; // 32KB, per blueprint

/**
 * WEAVE — write with provenance.
 *
 * Known gaps as of Day 3 (flagged, not silent):
 *  - anomaly detection not implemented; anomaly_flag is always null.
 *    Async detection is Day 4 scope per the blueprint.
 *  - workflow-scope expiry is a 7-day fallback, not the spec-correct
 *    behavior (expire on task close). True task-close integration is
 *    blocked on OKX not exposing a server-callable task-membership/
 *    status API — see permission-mode-policy.js for the same blocker
 *    affecting task_chain permission mode.
 *
 * @param {import('fastify').FastifyInstance} fastify
 * @param {{claimStore: import('../../core/ports/claim-store.js').ClaimStore,
 *          provenanceChain: import('../../core/ports/provenance-chain.js').ProvenanceChain,
 *          embeddingProvider: import('../../core/ports/embedding-provider.js').EmbeddingProvider,
 *          identityProvider: import('../../core/ports/identity-provider.js').IdentityProvider}} opts
 */
export default async function weaveRoutes(fastify, opts) {
  const { claimStore, provenanceChain, embeddingProvider, identityProvider } = opts;

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

      const normalizedPermission = validatePermission(permissions, taskId);

      if (!Object.values(ClaimScope).includes(scope)) {
        throw new ValidationError(
          `scope is required and must be one of: ${Object.values(ClaimScope).join(', ')}`
        );
      }

      const writerIdentityId = request.identity.identityId;
      const claimId = generateId('syn9_claim');
      const payloadHash = provenanceChain.hashPayload(payload);
      const timestamp = new Date();

      const embedding = await embeddingProvider.embed({
        text: JSON.stringify(payload),
        taskType: 'document',
      });

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
      } else if (scope === ClaimScope.WORKFLOW) {
        // Interim fallback, not the correct behavior per spec: true
        // workflow-scope expiry should fire on the originating OKX
        // task's close event, which requires task-close integration
        // that doesn't exist yet (Day 5 scope originally, now genuinely
        // blocked — see task_chain permission mode's gap note in
        // permission-mode-policy.js for why). A 7-day fallback bounds
        // storage growth in the meantime rather than leaving workflow
        // claims to persist forever, which directly contradicted the
        // blueprint's own cost-control design (persistent-scope storage
        // is explicitly priced to discourage indefinite retention).
        expiresAt = new Date(timestamp.getTime() + WORKFLOW_FALLBACK_TTL_MS);
      }

      const claim = new Claim({
        claimId,
        threadId,
        writerIdentityId,
        payload,
        payloadHash,
        embedding,
        permission: normalizedPermission,
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