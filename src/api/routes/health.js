/**
 * Health route — OKX ASP registration stub.
 *
 * Per the build blueprint, this must return 200 with a stable, minimal
 * schema before any real functionality exists, so the ASP can be
 * registered on the OKX marketplace on Day 1. Keep this route free of
 * dependencies on storage, identity, or any other module — it must stay
 * up even if every other module is degraded, since it's the liveness
 * signal.
 *
 * @param {import('fastify').FastifyInstance} fastify
 */
export default async function healthRoutes(fastify) {
  const startedAt = new Date();

  fastify.post('/v1/health', async () => {
    return {
      status: 'ok',
      service: 'syn9-asp',
      version: process.env.npm_package_version ?? '0.1.0',
      uptimeSeconds: Math.floor((Date.now() - startedAt.getTime()) / 1000),
      timestamp: new Date().toISOString(),
    };
  });
}