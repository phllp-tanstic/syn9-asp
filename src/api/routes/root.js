import { requirePayment } from '../middleware/payment.js';

/**
 * Root route.
 *
 * GET / stays a free, simple info response — useful for basic health
 * checks and human browsing.
 *
 * POST / is the x402-gated resource per OKX reviewer feedback on ASP
 * #4765 (July 15): their automated checker (x402-check/x402-validate)
 * hits the literal registered service endpoint directly, not any
 * dynamic sub-path — it has no way to know about
 * /v1/threads/:threadId/weave. The registered endpoint itself must
 * serve a valid 402 challenge with a real accepts[] array.
 *
 * @param {import('fastify').FastifyInstance} fastify
 * @param {{okxPaymentClient: import('../../modules/payment/okx-payment-client.js').OkxPaymentClient}} opts
 */
export default async function rootRoutes(fastify, opts) {
  const { okxPaymentClient } = opts;

  fastify.get('/', async () => {
    return {
      service: 'syn9-asp',
      description:
        'Provenance-verified, permissioned collaborative state layer for multi-agent workflows.',
      health_check: '/v1/health',
      paid_resource: 'POST / (or /v1/threads/:threadId/weave, /recall)',
      status: 'ok',
    };
  });

  fastify.post(
    '/',
    {
      preHandler: requirePayment({
        okxPaymentClient,
        amountFn: () => 2000, // matches WEAVE's price — this root resource represents general API access
        description: 'Syn9 API access — provenance-verified collaborative state layer',
      }),
    },
    async () => {
      return {
        service: 'syn9-asp',
        message: 'Payment verified. See /v1/threads/:threadId/weave, /recall, /entries/:id for actual operations.',
      };
    }
  );
}