import { requirePayment } from '../middleware/payment.js';
import { requireAuth } from '../middleware/auth.js';
import { performRecall } from '../../core/use-cases/perform-recall.js';
import { runDemoCycle } from './demo.js';

export default async function coreEndpointRoutes(fastify, opts) {
  const {
    okxPaymentClient,
    identityProvider,
    claimStore,
    provenanceChain,
    embeddingProvider,
    anomalyDetector,
    authorizationPolicy,
    auditLog,
    synthesisEngine,
  } = opts;

  const paymentGate = requirePayment({
    okxPaymentClient,
    identityProvider,
    amountFn: () => 2000,
    description: 'Syn9 Core API — WEAVE/RECALL/GRANT/REVOKE primitives',
  });

  fastify.get('/v1/core', { preHandler: paymentGate }, async () => {
    return {
      service: 'Syn9 Core API',
      tip: 'POST with intent (and optionally threadId) to RECALL. Omit threadId to auto-seed a demo thread.',
      example: { threadId: 'your-thread-uuid', intent: 'OKB price' },
    };
  });

  fastify.post('/v1/core', {
    preHandler: [paymentGate, requireAuth(identityProvider)],
  }, async (request, reply) => {
    const {
      threadId,
      intent,
      top_k = 3,
      min_similarity = 0.2,
      synthesis = false,
    } = request.body ?? {};

    if (!intent) {
      reply.code(400);
      return {
        error: 'MISSING_PARAMETER',
        message: 'intent is required.',
        example: { threadId: 'your-thread-uuid', intent: 'OKB price divergence' },
      };
    }

    if (!threadId) {
      const demo = await runDemoCycle({
        claimStore,
        provenanceChain,
        embeddingProvider,
        anomalyDetector,
        fastify,
        tier: 'standard',
      });

      const recall = await performRecall(
        { claimStore, embeddingProvider, authorizationPolicy, auditLog, synthesisEngine },
        {
          threadId: demo.thread_id,
          intent,
          topK: top_k,
          minSimilarity: min_similarity,
          synthesis,
          requesterIdentity: request.identity,
        }
      );

      reply.code(200);
      return {
        ...recall,
        demo_thread_id: demo.thread_id,
        note: 'No threadId provided — a demo thread was seeded automatically. Reuse demo_thread_id in future calls, or run POST /v1/research first to create your own thread.',
      };
    }

    return performRecall(
      { claimStore, embeddingProvider, authorizationPolicy, auditLog, synthesisEngine },
      {
        threadId,
        intent,
        topK: top_k,
        minSimilarity: min_similarity,
        synthesis,
        requesterIdentity: request.identity,
      }
    );
  });
}