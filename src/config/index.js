/**
 * Centralized configuration loader.
 *
 * Rule: no module outside this file reads `process.env` directly.
 * This keeps every external dependency (DB, keys, RPC URLs) declared
 * in one place and makes it trivial to see what Syn9 depends on.
 *
 * Each config section is owned by the module that consumes it. As
 * modules land (storage, identity, synthesis, anchor...), extend the
 * relevant section here rather than reading env vars ad hoc.
 */

function required(name, value, { requiredIn = [] } = {}) {
  const env = process.env.NODE_ENV ?? 'development';
  if (!value && requiredIn.includes(env)) {
    throw new Error(`Missing required environment variable: ${name} (required in ${env})`);
  }
  return value;
}

export const config = {
  env: process.env.NODE_ENV ?? 'development',

  server: {
    port: Number(process.env.PORT ?? 8080),
    host: process.env.HOST ?? '0.0.0.0',
    logLevel: process.env.LOG_LEVEL ?? 'info',
  },

  storage: {
    // Not eagerly validated here — nothing in server.js consumes this yet.
    // modules/storage will enforce its own requirement when it initializes
    // a connection pool (Day 2). Eager validation of unused config just
    // creates false-positive deploy failures.
    databaseUrl: process.env.DATABASE_URL ?? null,
    poolMax: Number(process.env.DATABASE_POOL_MAX ?? 10),
  },

  identity: {
    apiKeySalt: process.env.SYN9_API_KEY_SALT ?? null,
  },

  encryption: {
    key: process.env.SYN9_ENCRYPTION_KEY ?? null,
  },

  webhooks: {
    signingSecret: process.env.SYN9_WEBHOOK_SIGNING_SECRET ?? null,
    maxRetries: 3,
    retryBaseDelayMs: 1000,
  },

  synthesis: {
    groqApiKey: process.env.GROQ_API_KEY ?? null,
    model: process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile',
  }, 
  embeddings: {
    geminiApiKey: process.env.GEMINI_API_KEY ?? null,
    model: process.env.GEMINI_EMBEDDING_MODEL ?? 'gemini-embedding-001',
  },

  anchor: {
    xlayerRpcUrl: process.env.XLAYER_RPC_URL ?? null,
    xlayerContract: process.env.XLAYER_ANCHOR_CONTRACT ?? null,
    xlayerSignerKey: process.env.XLAYER_SIGNER_PRIVATE_KEY ?? null,
    sepoliaRpcUrl: process.env.SEPOLIA_RPC_URL ?? null,
    batchIntervalMinutes: Number(process.env.ANCHOR_BATCH_INTERVAL_MINUTES ?? 10),
  },

  payment: {
    apiKey: process.env.OKX_PAYMENT_API_KEY ?? null,
    secretKey: process.env.OKX_PAYMENT_SECRET_KEY ?? null,
    passphrase: process.env.OKX_PAYMENT_PASSPHRASE ?? null,
    projectId: process.env.OKX_PAYMENT_PROJECT_ID ?? null,
    // Syn9's own wallet — recipient of all payments (payTo field in
    // 402 challenges). Same wallet as the Agentic Wallet from Day 1.
    payToWallet: process.env.SYN9_AGENT_WALLET ?? null,
  },
};