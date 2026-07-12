/**
 * Root route — GET / returns basic service info.
 *
 * This is the exact URL registered as this ASP's service endpoint on
 * OKX AI. Without this route, that URL 404s, which could plausibly
 * stall or fail an automated review check even though the real API
 * (health, identities, weave, recall) works correctly at their own
 * paths. This route exists purely so the declared endpoint itself
 * responds with something meaningful rather than 404.
 */
export default async function rootRoutes(fastify) {
  fastify.get('/', async () => {
    return {
      service: 'syn9-asp',
      description:
        'Provenance-verified, permissioned collaborative state layer for multi-agent workflows.',
      health_check: '/v1/health',
      status: 'ok',
    };
  });
}