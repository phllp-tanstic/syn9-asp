import { requirePayment } from '../middleware/payment.js';

/**
 * Root route — the exact URL registered as this ASP's x402 service
 * endpoint.
 *
 * Per OKX reviewer feedback on ASP #4765 (July 16): their x402-check
 * tool probes via GET, not POST — the root resource must return 402
 * regardless of HTTP method. Previously GET / returned a free 200 info
 * response, which is why the checker reported "not a valid x402
 * service" even after POST / was correctly gated.
 *
 * Health/liveness checks live at GET /v1/health instead (free, no
 * payment) — that's the correct place for an unauthenticated status
 * check, not the paid resource root.
 *
 * @param {import('fastify').FastifyInstance} fastify
 * @param {{okxPaymentClient: import('../../modules/payment/okx-payment-client.js').OkxPaymentClient}} opts
 */
export default async function rootRoutes(fastify, opts) {
  const { okxPaymentClient } = opts;

  const paymentGate = requirePayment({
    okxPaymentClient,
    amountFn: () => 2000,
    description: 'Syn9 API access — provenance-verified collaborative state layer',
  });

  fastify.get('/', { preHandler: paymentGate }, async () => {
    return {
      service: 'syn9-asp',
      message: 'Payment verified. See /v1/threads/:threadId/weave, /recall, /entries/:id for actual operations.',
    };
  });

  fastify.post('/', { preHandler: paymentGate }, async () => {
    return {
      service: 'syn9-asp',
      message: 'Payment verified. See /v1/threads/:threadId/weave, /recall, /entries/:id for actual operations.',
    };
  });
}