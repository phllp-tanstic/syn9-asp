// src/api/routes/core-endpoint.js
//
// GET+POST /v1/core
//
// Dedicated marketplace listing endpoint for the Syn9 Core API service.
// OKX's x402-check tool probes this URL to verify the service fee matches
// the listed price (0.002 USDT). Both GET and POST return 402 with the
// correct challenge amount so the validator sees the right fee.
//
// Actual WEAVE/RECALL/GRANT/REVOKE operations remain at their existing
// paths — this endpoint exists solely for marketplace fee validation and
// as the canonical entry point buyers discover first.

import { requirePayment } from '../middleware/payment.js';
import { requireAuth } from '../middleware/auth.js';

export default async function coreEndpointRoutes(fastify, opts) {
  const { okxPaymentClient, identityProvider } = opts;

  const paymentGate = requirePayment({
    okxPaymentClient,
    identityProvider,
    amountFn: () => 2000, // $0.002 USDT — matches Core API listing fee
    description: 'Syn9 Core API — WEAVE/RECALL/GRANT/REVOKE primitives',
  });

  // GET — probed by OKX x402-check validator
  fastify.get('/v1/core', { preHandler: paymentGate }, async () => {
    return {
      service: 'Syn9 Core API',
      endpoints: {
        weave: 'POST /v1/threads/:threadId/weave',
        recall: 'POST /v1/threads/:threadId/recall',
        grant: 'POST /v1/threads/:threadId/entries/:id/grant',
        revoke: 'DELETE /v1/threads/:threadId/entries/:id',
        conflicts: 'GET /v1/threads/:threadId/conflicts',
      },
      example: {
        request: { payload: { your: 'data' }, permissions: { mode: 'explicit', allow: ['0xYourWallet'] }, scope: 'workflow' },
        response: { entry_id: 'syn9_claim_...', chain_hash: '0x...' },
      },
      setup: 'POST /v1/provision with your wallet address and EIP-191 signature to get credentials.',
    };
  });

  // POST — some validators probe via POST
  fastify.post('/v1/core', { preHandler: paymentGate }, async (request, reply) => {
  const { threadId, intent, top_k = 3, min_similarity = 0.2, synthesis = false } = request.body ?? {};

  if (!threadId || !intent) {
    return {
      service: 'Syn9 Core API',
      message: 'Provide threadId and intent in the request body to perform a RECALL, or use the dedicated endpoints: POST /v1/threads/:threadId/weave, POST /v1/threads/:threadId/recall',
      example: {
        threadId: 'your-thread-uuid',
        intent: 'describe what you are looking for',
        top_k: 3,
        synthesis: false,
      },
    };
  }

  // Proxy to internal recall logic
  const recallRes = await fetch(`https://syn9-asp-production.up.railway.app/v1/threads/${threadId}/recall`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': request.headers.authorization,
      'X-Agent-Wallet': request.headers['x-agent-wallet'],
    },
    body: JSON.stringify({ intent, top_k, min_similarity, synthesis }),
  });

  const data = await recallRes.json();
  reply.code(recallRes.status);
  return data;
  });
}