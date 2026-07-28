import { requireAuth } from '../middleware/auth.js';
import { requirePayment } from '../middleware/payment.js';
import { performRecall } from '../../core/use-cases/perform-recall.js';

/**
 * RECALL — permissioned semantic retrieval.
 *
 * Known gaps as of Day 4 (flagged, not silent):
 *  - task_chain-permissioned claims are unreadable by anyone (see
 *    PermissionModePolicy — deny-by-default until Day 5's OKX task
 *    membership integration lands).
 *
 * Design decision (not explicit in the blueprint's spec for the
 * multi-result case): when a similarity search returns some permitted
 * and some denied matches, denied ones are silently filtered from
 * results — the requester didn't ask for that specific entry, it just
 * scored high. Only when EVERY match above min_similarity is denied
 * does this return PERMISSION_DENIED (entry_exists: true, referencing
 * the top denied match) — this is the blueprint's demo moment: a
 * specific, visible, content-free denial.
 *
 * @param {import('fastify').FastifyInstance} fastify
 * @param {{claimStore, embeddingProvider, authorizationPolicy, auditLog,
 *          identityProvider}} opts
 */
export default async function recallRoutes(fastify, opts) {
  const { claimStore, embeddingProvider, authorizationPolicy, auditLog, synthesisEngine, identityProvider, okxPaymentClient } = opts;

  fastify.post(
    '/v1/threads/:threadId/recall',
    {
      preHandler: [
        requirePayment({
          okxPaymentClient,
          identityProvider,
          // Per blueprint constraint #5: raw RECALL must be near-free
          // so agents never have a financial incentive to skip a
          // context check. $0.00005 raw, $0.001 synthesized.
          amountFn: (body) => (body.synthesis ? 1000 : 50),
          description: 'Syn9 RECALL — permissioned semantic retrieval',
        }),
        requireAuth(identityProvider),
      ],
    },
    async (request, reply) => {
      const { threadId } = request.params;
      const {
        intent,
        top_k: topK,
        synthesis = false,
        min_similarity: minSimilarity,
      } = request.body ?? {};

      return performRecall(
        { claimStore, embeddingProvider, authorizationPolicy, auditLog, synthesisEngine },
        { threadId, intent, topK, minSimilarity, synthesis, requesterIdentity: request.identity }
      );
    }
  );
}