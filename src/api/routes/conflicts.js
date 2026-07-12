import { requireAuth } from '../middleware/auth.js';

/**
 * GET /v1/threads/:threadId/conflicts — polling endpoint for detected
 * conflicts.
 *
 * The durable source of truth for anomaly/conflict notifications.
 * Webhook delivery (see modules/webhooks/webhook-delivery.js) can fail
 * silently — wrong URL, receiver down, network blip — with no built-in
 * way for the caller to know delivery didn't happen. This endpoint
 * always reflects ground truth regardless of webhook delivery status,
 * matching standard practice for production webhook systems (Stripe,
 * GitHub, etc. all pair push delivery with a pollable/listable source
 * of truth).
 *
 * No fine-grained authorization on individual conflicts as of Day 4 —
 * any authenticated identity can list all conflicts in a thread they
 * know the ID of. This mirrors WEAVE/RECALL's existing thread-level
 * access model rather than introducing a new one; tightening this to
 * per-conflict visibility (e.g. only the two claim writers involved)
 * is a reasonable future refinement, not addressed here.
 *
 * @param {import('fastify').FastifyInstance} fastify
 * @param {{claimStore, identityProvider}} opts
 */
export default async function conflictsRoutes(fastify, opts) {
  const { claimStore, identityProvider } = opts;

  fastify.get(
    '/v1/threads/:threadId/conflicts',
    { preHandler: requireAuth(identityProvider) },
    async (request) => {
      const { threadId } = request.params;

      const conflicts = await claimStore.listConflictsInThread(threadId);

      return {
        conflicts: conflicts.map((c) => ({
          conflict_id: c.conflictId,
          claim_id: c.claimId,
          conflicts_with_claim_id: c.conflictsWithClaimId,
          similarity_score: c.similarityScore,
          summary: c.summary,
          status: c.status,
          detected_at: c.detectedAt.toISOString(),
        })),
      };
    }
  );
}