import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import { config } from '../config/index.js';
import { getPool } from '../modules/storage/postgres-client.js';
import { ApiKeyWalletProvider } from '../modules/identity/api-key-wallet-provider.js';
import healthRoutes from './routes/health.js';
import identitiesRoutes from './routes/identities.js';
import { Syn9Error } from '../core/domain/errors.js';
import { requireAuth } from './middleware/auth.js';


/**
 * Composition root for the HTTP layer.
 *
 * This is where port interfaces get bound to concrete implementations
 * (dependency injection by hand — no framework needed at this scale).
 * Routes receive their dependencies via Fastify's plugin options rather
 * than importing concrete modules directly, so route logic is testable
 * against the port interface alone.
 */
async function buildServer() {
  const fastify = Fastify({
    logger: {
      level: config.server.logLevel,
    },
  });

  await fastify.register(sensible);

  // Composition: wire concrete modules to the ports routes depend on.
  const pool = getPool();
  const identityProvider = new ApiKeyWalletProvider(pool);

  await fastify.register(healthRoutes);
  await fastify.register(identitiesRoutes, { identityProvider });
  // TEMPORARY diagnostic route — proves auth middleware works before
  // WEAVE exists to test against it. Remove once WEAVE lands.
  fastify.get(
    '/v1/whoami',
    { preHandler: requireAuth(identityProvider) },
    async (request) => {
      return { identity: request.identity };
    }
  );

  // Translate domain errors (core/domain/errors.js) into HTTP responses.
  // This is the one place in the codebase that maps Syn9Error -> status
  // code — core/ and modules/ stay transport-agnostic.
  fastify.setErrorHandler((error, request, reply) => {
    if (error instanceof Syn9Error) {
      const statusMap = {
        VALIDATION_ERROR: 400,
        AUTHENTICATION_ERROR: 401,
        PERMISSION_DENIED: 403,
        NOT_FOUND: 404,
        NOT_IMPLEMENTED: 501,
        CHAIN_INTEGRITY_ERROR: 500,
      };
      const status = statusMap[error.code] ?? 500;
      reply.code(status).send({
        error: error.code,
        message: error.message,
        ...(error.entryExists !== undefined && { entryExists: error.entryExists }),
      });
      return;
    }

    fastify.log.error(error);
    reply.code(500).send({ error: 'INTERNAL_ERROR', message: 'Unexpected error' });
  });

  return fastify;
}

async function start() {
  const fastify = await buildServer();

  try {
    await fastify.listen({ port: config.server.port, host: config.server.host });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }

  const shutdown = async (signal) => {
    fastify.log.info(`Received ${signal}, shutting down gracefully`);
    await fastify.close();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start();