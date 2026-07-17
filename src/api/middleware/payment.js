import { buildChallenge } from '../../modules/payment/x402-challenge.js';

/**
 * requirePayment — Fastify preHandler factory implementing x402 payment
 * gating.
 *
 * Flow:
 *  1. No X-PAYMENT header -> respond 402, PAYMENT-REQUIRED header
 *     carries the base64 challenge (per x402 v2 spec).
 *  2. X-PAYMENT header present -> decode paymentPayload, verify with
 *     OKX (does the signature/authorization check out), settle
 *     (queues on-chain settlement — per OKX's own docs, success:true
 *     here means "accepted", NOT "confirmed on-chain" — final
 *     confirmation is async via settle/status, which this gate does
 *     NOT wait for, matching OKX's own documented async-settlement
 *     pattern for exactly this kind of low-value, high-frequency call).
 *
 * amountFn receives the parsed request body so callers (RECALL) can
 * charge different amounts based on request content (synthesis vs
 * raw) — WEAVE just returns a fixed amount.
 *
 * @param {{okxPaymentClient: import('../../modules/payment/okx-payment-client.js').OkxPaymentClient,
 *          amountFn: (body: object) => number,
 *          description: string}} params
 */
export function requirePayment({ okxPaymentClient, amountFn, description }) {
  return async function paymentPreHandler(request, reply) {
    const amount = amountFn(request.body ?? {});
    const resourceUrl = `${request.protocol}://${request.hostname}${request.url}`;

    const paymentHeader = request.headers['payment-signature'];

    if (!paymentHeader) {
      const challenge = buildChallenge({ amount, resourceUrl, description });
      const challengeBase64 = Buffer.from(JSON.stringify(challenge)).toString('base64');
      reply.header('PAYMENT-REQUIRED', challengeBase64);
      reply.code(402).send({
        error: 'PAYMENT_REQUIRED',
        message: `This endpoint requires payment. See PAYMENT-REQUIRED header for challenge details.`,
        x402Version: 2,
      });
      return reply; // short-circuits the route handler
    }

    let paymentPayload;
    try {
      paymentPayload = JSON.parse(Buffer.from(paymentHeader, 'base64').toString('utf8'));
    } catch {
      reply.code(400).send({ error: 'INVALID_PAYMENT_HEADER', message: 'X-PAYMENT header is not valid base64 JSON' });
      return reply;
    }

    const challenge = buildChallenge({ amount, resourceUrl, description });
    const paymentRequirements = challenge.accepts[0];

    try {
      await okxPaymentClient.verify({ paymentPayload, paymentRequirements });
      const settleResult = await okxPaymentClient.settle({ paymentPayload, paymentRequirements });
      request.payment = { settled: true, ...settleResult };
    } catch (err) {
      reply.code(402).send({
        error: 'PAYMENT_VERIFICATION_FAILED',
        message: err.message,
      });
      return reply;
    }
  };
}