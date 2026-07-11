import { ValidationError, PermissionDeniedError } from '../../core/domain/errors.js';
import { generateId } from '../../core/domain/id.js';
import { requireAuth } from '../middleware/auth.js';

const DEFAULT_TOP_K = 3;
const MAX_TOP_K = 10;
const DEFAULT_MIN_SIMILARITY = 0.75;

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
  const { claimStore, embeddingProvider, authorizationPolicy, auditLog, synthesisEngine, identityProvider } = opts;


  fastify.post(
    '/v1/threads/:threadId/recall',
    { preHandler: requireAuth(identityProvider) },
    async (request, reply) => {
      const { threadId } = request.params;
      const {
        intent,
        top_k: topKRaw,
        synthesis = false,
        min_similarity: minSimilarityRaw,
      } = request.body ?? {};

      if (!intent || typeof intent !== 'string') {
        throw new ValidationError('intent is required and must be a string');
      }

      const topK = Math.min(topKRaw ?? DEFAULT_TOP_K, MAX_TOP_K);
      const minSimilarity = minSimilarityRaw ?? DEFAULT_MIN_SIMILARITY;

      const queryEmbedding = await embeddingProvider.embed({
        text: intent,
        taskType: 'query',
      });

      const matches = await claimStore.searchBySimilarity({
        threadId,
        queryEmbedding,
        topK,
        minSimilarity,
      });

      const allowed = [];
      const denied = [];

      for (const match of matches) {
        const decision = await authorizationPolicy.evaluate({
          claim: match.claim,
          requesterIdentity: request.identity,
          action: 'read',
        });
        if (decision.allowed) {
          allowed.push(match);
        } else {
          denied.push(match);
        }
      }

      // All matches denied, none permitted -> the visible denial moment.
      if (allowed.length === 0 && denied.length > 0) {
        const topDenied = denied[0];

        await auditLog.record({
          type: 'permission_denied',
          threadId,
          actorIdentityId: request.identity.identityId,
          detail: { attempted_claim_id: topDenied.claim.claimId },
        });

        throw new PermissionDeniedError('Access denied for the matched claim', {
          entryExists: true,
          reason: 'NOT_AUTHORIZED',
        });
      }

      const results = allowed.map((match) => ({
        entry_id: match.claim.claimId,
        payload: match.claim.payload,
        similarity_score: match.similarityScore,
        writer_identity_id: match.claim.writerIdentityId,
        chain_hash: match.claim.chainHash,
        timestamp: match.claim.createdAt.toISOString(),
        permission_verified: true,
      }));

      const sourceEntryIds = results.map((r) => r.entry_id);
      const receiptId = generateId('rcpt');

      await auditLog.record({
        type: 'recall',
        threadId,
        actorIdentityId: request.identity.identityId,
        detail: {
          receipt_id: receiptId,
          source_entry_ids: sourceEntryIds,
          synthesis_used: synthesis,
        },
      });

      let synthesizedContext = null;
      if (synthesis) {
        const synthesisResult = await synthesisEngine.synthesize({
          taskIntent: intent,
          permittedClaims: allowed.map((match) => match.claim),
        });
        synthesizedContext = synthesisResult.synthesizedView;
      }

      return {
        results,
        synthesized_context: synthesizedContext,
        source_entry_ids: sourceEntryIds,
        read_receipt_id: receiptId,
      };
    }
  );
}