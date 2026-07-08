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
    databaseUrl: required('DATABASE_URL', process.env.DATABASE_URL, {
      requiredIn: ['production'],
    }),
    poolMax: Number(process.env.DATABASE_POOL_MAX ?? 10),
  },

  identity: {
    apiKeySalt: process.env.SYN9_API_KEY_SALT ?? null,
  },

  synthesis: {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? null,
    model: process.env.SYNTHESIS_MODEL ?? 'claude-sonnet-4-6',
  },

  embeddings: {
    openaiApiKey: process.env.OPENAI_API_KEY ?? null,
    model: process.env.EMBEDDING_MODEL ?? 'text-embedding-3-small',
  },

  anchor: {
    xlayerRpcUrl: process.env.XLAYER_RPC_URL ?? null,
    xlayerContract: process.env.XLAYER_ANCHOR_CONTRACT ?? null,
    xlayerSignerKey: process.env.XLAYER_SIGNER_PRIVATE_KEY ?? null,
    sepoliaRpcUrl: process.env.SEPOLIA_RPC_URL ?? null,
    batchIntervalMinutes: Number(process.env.ANCHOR_BATCH_INTERVAL_MINUTES ?? 10),
  },

  payment: {
    okxPaymentSdkKey: process.env.OKX_PAYMENT_SDK_KEY ?? null,
    x402FacilitatorUrl: process.env.X402_FACILITATOR_URL ?? null,
  },
};