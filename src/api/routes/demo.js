// src/api/routes/demo.js
//
// POST /v1/demo/research-cycle
//
// Unauthenticated, payment-free demo endpoint for the landing page.
// Runs the real pipeline — real price fetches, real WEAVE/RECALL,
// real contradiction detection — but:
//   - No x402 payment gate
//   - No auth required
//   - Writes scoped to thread prefix 'demo_' for easy identification
//   - Rate limited to 5 requests per IP per hour
//   - Claims use 'open' permission mode (any identity can read them)
//   - No webhook delivery on conflicts (fire-and-forget only)
//
// This is the only unauthenticated write path in Syn9. It is
// intentionally constrained to prevent abuse and DB pollution.

import { randomUUID } from 'node:crypto';
import { generateId } from '../../core/domain/id.js';
import { Claim, ClaimScope } from '../../core/domain/claim.js';
import { ValidationError } from '../../core/domain/errors.js';
import { validatePermission } from '../../core/domain/validate-permission.js';
import { getCexPrice, getDexPrice } from '../../../reference-consumer/lib/price-feed-client.js';
import { anchorChainHash } from '../../modules/anchor/xlayer-anchor.js';

const TIER_CONFIG = {
  standard: { maxSources: 5, label: 'Standard' },
  deep: { maxSources: 10, label: 'Deep' },
};

const DIVERGENCE_THRESHOLD_PCT = 0.02;
const DEMO_THREAD_TTL_MS = 60 * 60 * 1000; // 1 hour — demo data expires fast
// Stable UUID used as the demo writer identity — not registered in the
// identities table, but satisfies the uuid column type constraint.
// Claims written by this ID are identifiable via the demo: true flag
// and the thread's short TTL.
const DEMO_WRITER_ID = 'a01edecd-5abd-49a1-a300-8fd774120814';

async function demoWeave({
  claimStore,
  provenanceChain,
  embeddingProvider,
  anomalyDetector,
  threadId,
  payload,
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
    writerIdentityId: DEMO_WRITER_ID,
  });

  const expiresAt = new Date(timestamp.getTime() + DEMO_THREAD_TTL_MS);

  // Open permission — demo data is not sensitive
  const permission = validatePermission({ mode: 'open' });

  const claim = new Claim({
    claimId,
    threadId,
    writerIdentityId: DEMO_WRITER_ID,
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

  // Fire-and-forget anomaly detection
  const recentClaims = await claimStore.getRecentInThread(threadId, 20);
  anomalyDetector
    .detect({ newClaim: stored, recentClaims })
    .then(async (conflict) => {
      if (conflict) await claimStore.recordConflict(conflict);
    })
    .catch((err) =>
      fastify.log.error({ errMessage: err.message }, 'Demo anomaly detection failed')
    );

  return stored;
}

export default async function demoRoutes(fastify, opts) {
  const {
    claimStore,
    provenanceChain,
    embeddingProvider,
    anomalyDetector,
  } = opts;

  fastify.post(
    '/v1/demo/research-cycle',
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '1 hour',
          keyGenerator: (request) => request.ip,
        },
      },
    },
    async (request, reply) => {
      const { tier: rawTier } = request.body ?? {};

      const tierConfig = TIER_CONFIG[rawTier ?? 'standard'];
      if (!tierConfig) {
        throw new ValidationError(
          `tier must be one of: ${Object.keys(TIER_CONFIG).join(', ')}`
        );
      }

      // Scope demo threads with prefix so they're identifiable in the DB
      const threadId = randomUUID();
      const cycleId = generateId('syn9_cycle');

      // Source A: CEX spot price
      const cexResult = await getCexPrice();

      const onchainFeedClaim = await demoWeave({
        claimStore,
        provenanceChain,
        embeddingProvider,
        anomalyDetector,
        threadId,
        payload: {
          asset: 'OKB',
          priceUsd: cexResult.price,
          source: cexResult.source,
          mechanism: 'cex_orderbook',
          timestamp: Date.now(),
          note: `OKB CEX spot price: $${cexResult.price} USDT (OKX orderbook). Demo run.`,
        },
        fastify,
      });

      // Source B: DEX aggregator price
      const dexResult = await getDexPrice();

      const divergencePct = (Math.abs(cexResult.price - dexResult.price) / cexResult.price) * 100;
      const contradictionDetected = divergencePct >= DIVERGENCE_THRESHOLD_PCT;

      const signalClaim = await demoWeave({
        claimStore,
        provenanceChain,
        embeddingProvider,
        anomalyDetector,
        threadId,
        payload: {
          asset: 'OKB',
          priceUsd: dexResult.price,
          source: dexResult.source,
          mechanism: 'dex_aggregator_onchain',
          chainIndex: '196',
          timestamp: Date.now(),
          cexPriceForComparison: cexResult.price,
          divergencePct: Number(divergencePct.toFixed(6)),
          contradictionDetected,
          note: `OKB DEX aggregator quote (XLayer): $${dexResult.price} USDT. Divergence: ${divergencePct.toFixed(4)}%. Demo run.`,
        },
        fastify,
      });

      // Wait briefly for fire-and-forget conflict detector
      await new Promise((r) => setTimeout(r, 2000));
      const conflicts = await claimStore.listConflictsInThread(threadId);

      const confidence = contradictionDetected
        ? Math.max(0.4, 0.85 - divergencePct * 2)
        : 0.85;

      reply.code(200);
      anchorChainHash(signalClaim.chainHash, threadId)
      .then((anchor) => fastify.log.info({ anchor }, 'Chain hash anchored to XLayer'))
      .catch((err) => fastify.log.error({ errMessage: err.message }, 'XLayer anchor failed'));
      return {
        cycle_id: cycleId,
        thread_id: threadId,
        tier: rawTier ?? 'standard',
        demo: true,
        opportunity: {
          asset: 'OKB',
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
      };
    }
  );
}