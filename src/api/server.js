import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import { config } from '../config/index.js';
import healthRoutes from './routes/health.js';

/**
 * Composition root for the HTTP layer.
 *
 * As modules land (Day 2+), route files will receive their dependencies
 * (ClaimStore, IdentityProvider, etc.) via a DI container rather than
 * importing concrete implementations directly — keeping routes testable
 * against port interfaces. That container doesn't exist yet because no
 * module has landed yet; this file will grow, not this comment's promise.
 */
async function buildServer() {
  const fastify = Fastify({
    logger: {
      level: config.server.logLevel,
    },
  });

  await fastify.register(sensible);
  await fastify.register(healthRoutes);

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