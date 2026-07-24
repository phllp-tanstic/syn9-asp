// src/api/routes/research-cycles.js
//
// POST /v1/research-cycles
//
// Per-cycle billing: one x402 payment gates the entire multi-step
// research pipeline. Internal WEAVE/RECALL operations call domain
// logic directly — they never hit the x402 middleware, so no per-call
// payment overhead, no onchainos shell-out per step.
//
// Tiers:
//   standard  ≤5 sources   $0.50  (500000 smallest USDT units, 6 dec)
//   deep      ≤10 sources  $1.00  (1000000 smallest USDT units, 6 dec)
//
// Response: { cycle_id, thread_id, tier, opportunity, provenance, contradictions }

import { randomUUID } from 'node:crypto';
import { generateId } from '../../core/domain/id.js';
import { Claim, ClaimScope } from '../../core/domain/claim.js';
import { ValidationError } from '../../core/domain/errors.js';
import { validatePermission } from '../../core/domain/validate-permission.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePayment } from '../middleware/payment.js';
import { getCexPrice, getDexPrice } from '../../../reference-consumer/lib/price-feed-client.js';
import { anchorChainHash } from '../../modules/anchor/xlayer-anchor.js';

const TIER_CONFIG = {
  standard: { maxSources: 5, amount: 500000, label: 'Standard (≤5 sources)' },
  deep:     { maxSources: 10, amount: 1000000, label: 'Deep (≤10 sources)' },
};

const DIVERGENCE_THRESHOLD_PCT = 0.02;
const WORKFLOW_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Writes a claim directly via domain logic — no HTTP, no x402 gate.
 * Mirrors weave.js exactly: same Claim construction, same chain hash,
 * same fire-and-forget anomaly detection. Only difference: no payment
 * middleware (already settled at the cycle route level).
 */
async function internalWeave({
  claimStore,
  provenanceChain,
  embeddingProvider,
  anomalyDetector,
  threadId,
  writerIdentityId,
  payload,
  allowedWallets,
  fastify,
}) {
  const claimId = generateId('syn9_claim');
  const payloadHash = provenanceChain.hashPayload(payload);
  const timestamp = new Date();

  const embedding = await embeddingProvider.embed({
    text: JSON.stringify(payload),
    taskType: 'document',
  });

  const latestClaim = await claimStore.getLatestInThread(threadId);
  const prevHash = latestClaim ? latestClaim.chainHash : null;

  const chainHash = provenanceChain.computeHash({
    prevHash,
    claimId,
    payloadHash,
    timestamp: timestamp.toISOString(),
    writerIdentityId,
  });

  const expiresAt = new Date(timestamp.getTime() + WORKFLOW_TTL_MS);

  // explicit mode, allow only the caller — same as passing
  // { mode: 'explicit', allow: [callerWallet] } through validatePermission
  const permission = validatePermission({
    mode: 'explicit',
    allow: allowedWallets,
  });

  const claim = new Claim({
    claimId,
    threadId,
    writerIdentityId,
    payload,
    payloadHash,
    embedding,
    permission,
    scope: ClaimScope.WORKFLOW,
    chainHash,
    prevHash,
    createdAt: timestamp,
    expiresAt,
  });

  const stored = await claimStore.append(claim);

  // Fire-and-forget anomaly detection — identical pattern to weave.js
  const recentClaims = await claimStore.getRecentInThread(threadId, 20);
  anomalyDetector
    .detect({ newClaim: stored, recentClaims })
    .then(async (conflict) => {
      if (conflict) await claimStore.recordConflict(conflict);
    })
    .catch((err) =>
      fastify.log.error({ errMessage: err.message }, 'Cycle anomaly detection failed')
    );

  return stored;
}

/**
 * Semantic retrieval via domain logic — no HTTP, no x402 gate.
 * Uses the exact same searchBySimilarity + authorizationPolicy.evaluate
 * pattern as recall.js.
 */
async function internalRecall({
  claimStore,
  embeddingProvider,
  authorizationPolicy,
  threadId,
  callerIdentity,
  intent,
  topK = 5,
  minSimilarity = 0.2,
}) {
  const queryEmbedding = await embeddingProvider.embed({
    text: intent,
    taskType: 'query',
  });

  const matches = await claimStore.searchBySimilarity({
    threadId,
    queryEmbedding,
    topK,
    minSimilarity,
  });

  const permitted = [];
  for (const match of matches) {
    const decision = await authorizationPolicy.evaluate({
      claim: match.claim,
      requesterIdentity: callerIdentity,
      action: 'read',
    });
    if (decision.allowed) permitted.push(match);
  }

  return permitted;
}

export default async function researchCyclesRoutes(fastify, opts) {
  const {
    claimStore,
    provenanceChain,
    embeddingProvider,
    anomalyDetector,
    identityProvider,
    authorizationPolicy,
    okxPaymentClient,
  } = opts;

  fastify.post(
    '/v1/research-cycles',
    {
      preHandler: [
        requireAuth(identityProvider),
        requirePayment({
          okxPaymentClient,
          amountFn: (body) => {
            const tier = TIER_CONFIG[body?.tier];
            return tier ? tier.amount : TIER_CONFIG.standard.amount;
          },
          description: 'Syn9 Research Cycle — multi-source DeFi provenance pipeline',
        }),
      ],
    },
    async (request, reply) => {
      const { tier: rawTier, thread_id: existingThreadId, assets } = request.body ?? {};

      // --- Input validation ---
      const tierConfig = TIER_CONFIG[rawTier];
      if (!tierConfig) {
        throw new ValidationError(
          `tier must be one of: ${Object.keys(TIER_CONFIG).join(', ')}`
        );
      }

      if (assets !== undefined && (!Array.isArray(assets) || assets.length === 0)) {
        throw new ValidationError('assets must be a non-empty array if provided');
      }

      if (assets && assets.length > tierConfig.maxSources) {
        throw new ValidationError(
          `tier '${rawTier}' supports at most ${tierConfig.maxSources} sources; ${assets.length} provided`
        );
      }

      const threadId = existingThreadId ?? randomUUID();
      const callerIdentityId = request.identity.identityId;
      // allowedWallets scopes claims to the caller's wallet address
      const callerWallet = request.identity.walletAddress;
      const cycleId = generateId('syn9_cycle');
      const asset = assets?.[0] ?? 'OKB';

      // --- Source A: CEX spot price ---
      const cexResult = await getCexPrice();

      const onchainFeedClaim = await internalWeave({
        claimStore,
        provenanceChain,
        embeddingProvider,
        anomalyDetector,
        threadId,
        writerIdentityId: callerIdentityId,
        payload: {
          asset,
          priceUsd: cexResult.price,
          source: cexResult.source,
          mechanism: 'cex_orderbook',
          timestamp: Date.now(),
          note: `${asset} CEX spot price: $${cexResult.price} USDT (OKX orderbook).`,
        },
        allowedWallets: [callerWallet],
        fastify,
      });

      // --- Source B: DEX aggregator price ---
      const dexResult = await getDexPrice();

      const divergencePct = (Math.abs(cexResult.price - dexResult.price) / cexResult.price) * 100;
      const contradictionDetected = divergencePct >= DIVERGENCE_THRESHOLD_PCT;

      const signalClaim = await internalWeave({
        claimStore,
        provenanceChain,
        embeddingProvider,
        anomalyDetector,
        threadId,
        writerIdentityId: callerIdentityId,
        payload: {
          asset,
          priceUsd: dexResult.price,
          source: dexResult.source,
          mechanism: 'dex_aggregator_onchain',
          chainIndex: '196',
          timestamp: Date.now(),
          cexPriceForComparison: cexResult.price,
          divergencePct: Number(divergencePct.toFixed(6)),
          contradictionDetected,
          note: `${asset} DEX aggregator quote (XLayer): $${dexResult.price} USDT. ` +
                `Divergence from CEX: ${divergencePct.toFixed(4)}%. ` +
                (contradictionDetected ? 'CONTRADICTION FLAGGED.' : 'Within normal bounds.'),
        },
        allowedWallets: [callerWallet],
        fastify,
      });

      // --- Internal RECALL: pull both claims for strategy output ---
      const recalled = await internalRecall({
        claimStore,
        embeddingProvider,
        authorizationPolicy,
        threadId,
        callerIdentity: request.identity,
        intent: `${asset} price observations from CEX and DEX sources`,
        topK: 5,
        minSimilarity: 0.2,
      });

      // --- Poll conflicts (brief wait for fire-and-forget detector) ---
      await new Promise((r) => setTimeout(r, 2000));
      const conflicts = await claimStore.listConflictsInThread(threadId);

      // --- Assemble structured output ---
      const confidence = contradictionDetected
        ? Math.max(0.4, 0.85 - divergencePct * 2)
        : 0.85;

      reply.code(201);
      // Fire-and-forget anchor — writes the latest chain hash to XLayer.
      // Never blocks the response or fails the cycle if anchoring fails.
      anchorChainHash(signalClaim.chainHash, threadId)
      .then((anchor) => fastify.log.info({ anchor }, 'Chain hash anchored to XLayer'))
      .catch((err) => fastify.log.error({ errMessage: err.message }, 'XLayer anchor failed'));
      return {
        cycle_id: cycleId,
        thread_id: threadId,
        tier: rawTier,
        opportunity: {
          asset,
          cexPriceUsd: cexResult.price,
          dexPriceUsd: dexResult.price,
          priceDivergencePct: Number(divergencePct.toFixed(6)),
          contradictionDetected,
          arbDirectionNote: dexResult.price < cexResult.price
            ? `DEX ($${dexResult.price}) below CEX ($${cexResult.price}) — potential buy-DEX/sell-CEX`
            : `CEX ($${cexResult.price}) below DEX ($${dexResult.price}) — potential buy-CEX/sell-DEX`,
          riskTier: contradictionDetected ? 'ELEVATED' : 'NORMAL',
          confidence: Number(confidence.toFixed(4)),
          recommendation: contradictionDetected
            ? 'INVESTIGATE — price-discovery sources diverge; verify liquidity depth before execution'
            : 'MONITOR — sources consistent; within normal arbitrage bounds',
        },
        provenance: [
          {
            sourceId: 'onchain_feed',
            entryId: onchainFeedClaim.claimId,
            chainHash: onchainFeedClaim.chainHash,
            mechanism: 'cex_orderbook',
            ingestedAt: onchainFeedClaim.createdAt.toISOString(),
            confidence: 0.95,
            priceObserved: cexResult.price,
          },
          {
            sourceId: 'signal_analyst',
            entryId: signalClaim.claimId,
            chainHash: signalClaim.chainHash,
            mechanism: 'dex_aggregator_onchain',
            ingestedAt: signalClaim.createdAt.toISOString(),
            confidence: 0.92,
            priceObserved: dexResult.price,
          },
        ],
        contradictions: conflicts.map((c) => ({
          conflict_id: c.conflictId,
          claim_id: c.claimId,
          conflicts_with_claim_id: c.conflictsWithClaimId,
          similarity_score: c.similarityScore,
          summary: c.summary,
          status: c.status,
          detected_at: c.detectedAt instanceof Date ? c.detectedAt.toISOString() : c.detectedAt,
        })),
        sources_recalled: recalled.length,
      };
    }
  );
}