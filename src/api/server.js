import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import { config } from '../config/index.js';
import { getPool } from '../modules/storage/postgres-client.js';
import { ApiKeyWalletProvider } from '../modules/identity/api-key-wallet-provider.js';
import healthRoutes from './routes/health.js';
import identitiesRoutes from './routes/identities.js';
import { Syn9Error } from '../core/domain/errors.js';
import { requireAuth } from './middleware/auth.js';
import { PostgresClaimStore } from '../modules/storage/postgres-claim-store.js';
import { Sha256Chain } from '../modules/provenance/sha256-chain.js';
import weaveRoutes from './routes/weave.js';
import revokeRoutes from './routes/revoke.js';
import { GeminiEmbeddingProvider } from '../modules/embeddings/gemini-embedding-provider.js';
import { PermissionModePolicy } from '../modules/authorization/permission-mode-policy.js';
import { PostgresAuditLog } from '../modules/audit/postgres-audit-log.js';
import recallRoutes from './routes/recall.js';
import { fileURLToPath } from 'node:url';
import { GroqSynthesisEngine } from '../modules/synthesis/groq-synthesis-engine.js';
import { AesGcmEncryptionProvider } from '../modules/encryption/aes-gcm-encryption-provider.js';
import rateLimit from '@fastify/rate-limit';
import { GroqAnomalyDetector } from '../modules/anomaly/groq-anomaly-detector.js';
import conflictsRoutes from './routes/conflicts.js';

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

  // Global baseline rate limit — cheap protection against basic abuse
  // across every route. Per-route limits (below) layer stricter rules
  // on top for specific high-risk endpoints.
  await fastify.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });

  // Error handler registered before any routes — Fastify's plugin
  // encapsulation means each fastify.register() call snapshots the
  // parent's state at that moment. A handler added after routes are
  // registered would not apply to those routes' encapsulated contexts.
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

    if (error.statusCode === 429) {
      reply.code(429).send({
        error: 'RATE_LIMIT_EXCEEDED',
        message: error.message,
      });
      return;
    }

    // Preserve a statusCode Fastify or a plugin already assigned (e.g.
    // malformed JSON body -> 400) rather than always forcing 500, which
    // would misreport legitimate client errors as server failures.
    const statusCode = error.statusCode ?? 500;
    if (statusCode >= 500) {
      fastify.log.error(error);
    }
    reply.code(statusCode).send({
      error: error.code ?? 'INTERNAL_ERROR',
      message: error.message ?? 'Unexpected error',
    });
  });

  // Composition: wire concrete modules to the ports routes depend on.
  const pool = getPool();
  const identityProvider = new ApiKeyWalletProvider(pool);
  const encryptionProvider = new AesGcmEncryptionProvider();
  const claimStore = new PostgresClaimStore(pool, encryptionProvider);
  const provenanceChain = new Sha256Chain();
  const embeddingProvider = new GeminiEmbeddingProvider();
  const authorizationPolicy = new PermissionModePolicy();
  const auditLog = new PostgresAuditLog(pool, provenanceChain);
  const synthesisEngine = new GroqSynthesisEngine();
  const anomalyDetector = new GroqAnomalyDetector();

  await fastify.register(healthRoutes);
  await fastify.register(identitiesRoutes, { identityProvider });
  await fastify.register(revokeRoutes, { claimStore, identityProvider });
  await fastify.register(recallRoutes, { claimStore, embeddingProvider, authorizationPolicy, auditLog, synthesisEngine, identityProvider });
  await fastify.register(weaveRoutes, { claimStore, provenanceChain, embeddingProvider, anomalyDetector, identityProvider });
  await fastify.register(conflictsRoutes, { claimStore, identityProvider });

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

export { buildServer };

// Only start listening when this file is run directly (`node server.js`
// or `npm run dev`/`start`) — not when imported by tests, which use
// buildServer() + Fastify's inject() instead of binding a real port.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  start();
}