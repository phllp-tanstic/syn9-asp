import { generateId } from '../../core/domain/id.js';
import { Claim, ClaimScope } from '../../core/domain/claim.js';
import { ValidationError } from '../../core/domain/errors.js';
import { validatePermission } from '../../core/domain/validate-permission.js';
import { requireAuth } from '../middleware/auth.js';
import { deliverWebhook } from '../../modules/webhooks/webhook-delivery.js';
import { requirePayment } from '../middleware/payment.js';

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const WORKFLOW_FALLBACK_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_PAYLOAD_BYTES = 32 * 1024; // 32KB, per blueprint

/**
 * WEAVE — write with provenance.
 *
 * Known gaps as of Day 4 (flagged, not silent):
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
 *          anomalyDetector: import('../../core/ports/anomaly-detector.js').AnomalyDetector,
 *          identityProvider: import('../../core/ports/identity-provider.js').IdentityProvider}} opts
 */
export default async function weaveRoutes(fastify, opts) {
  const { claimStore, provenanceChain, embeddingProvider, anomalyDetector, identityProvider, okxPaymentClient } = opts;

  fastify.post(
    '/v1/threads/:threadId/weave',
    {
      preHandler: [
        requireAuth(identityProvider),
        requirePayment({
          okxPaymentClient,
          amountFn: () => 2000, // $0.002 per blueprint pricing table, smallest-unit amount
          description: 'Syn9 WEAVE — write with provenance',
        }),
      ],
    },
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
        // Interim fallback, not the correct behavior per spec — see
        // gap note above.
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

      // Fire-and-forget anomaly detection — runs AFTER the response is
      // built, deliberately not awaited in the response path. Per
      // blueprint constraint #3, a write that triggers an anomaly flag
      // still completes and returns a chain hash; the flag is metadata,
      // never a gate. Errors inside this block must never surface to
      // the caller of WEAVE.
      const recentClaims = await claimStore.getRecentInThread(threadId, 20);
      detectAndNotifyConflict({
        anomalyDetector,
        claimStore,
        identityProvider,
        newClaim: stored,
        recentClaims,
      }).catch((err) => {
        fastify.log.error({ errMessage: err.message, errStack: err.stack }, 'Anomaly detection background task failed');
      });

      reply.code(201);
      return {
        entry_id: stored.claimId,
        chain_hash: stored.chainHash,
        timestamp: stored.createdAt.toISOString(),
        anomaly_flag: null, // advisory flag delivered async via webhook/polling, never inline
      };
    }
  );
}

/**
 * Runs anomaly detection and, if a conflict is found, persists it and
 * fires a webhook notification to the original writer of the
 * contradicted claim. Deliberately not exported/awaited by the route
 * handler — see the call site's comment above for why.
 */
async function detectAndNotifyConflict({
  anomalyDetector,
  claimStore,
  identityProvider,
  newClaim,
  recentClaims,
}) {
  const conflict = await anomalyDetector.detect({ newClaim, recentClaims });
  if (!conflict) return;

  await claimStore.recordConflict(conflict);

  const contradictedClaim = recentClaims.find(
    (c) => c.claimId === conflict.conflictsWithClaimId
  );
  if (!contradictedClaim) return;

  const writerIdentity = await identityProvider.getById(
    contradictedClaim.writerIdentityId
  );
  if (!writerIdentity?.webhookUrl) return;

  await deliverWebhook({
    url: writerIdentity.webhookUrl,
    event: {
      type: 'conflict_detected',
      conflict_id: conflict.conflictId,
      thread_id: conflict.threadId,
      claim_id: conflict.claimId,
      conflicts_with_claim_id: conflict.conflictsWithClaimId,
      similarity_score: conflict.similarityScore,
      summary: conflict.summary,
      detected_at: conflict.detectedAt.toISOString(),
    },
  });
}