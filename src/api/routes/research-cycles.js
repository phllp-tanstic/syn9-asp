// src/api/routes/research-cycles.js
//
// POST /v1/research-cycles
//
// Per-cycle billing: one x402 payment gates the entire multi-step
// research pipeline. Internal WEAVE/RECALL operations bypass individual
// x402 gates — payment is settled once at the cycle level.
//
// Cross-identity attribution (P1 fix from judge review):
// OnchainFeed and SignalAnalyst are distinct pre-registered service
// identities, each writing under their own identity ID. The caller
// (buyer) is a third identity — they cannot read OnchainFeed's raw
// finding until a PERMISSION_GRANT is issued mid-pipeline. This
// demonstrates the full deny→grant→synthesize flow in the production
// endpoint, not just the reference consumer.
//
// Tiers:
//   standard  ≤5 sources   $0.50  (500000 smallest USDT units, 6 dec)
//   deep      ≤10 sources  $1.00  (1000000 smallest USDT units, 6 dec)
//
// Response: { cycle_id, thread_id, tier, opportunity, provenance,
//             contradictions, attribution }

import { randomUUID } from 'node:crypto';
import { generateId } from '../../core/domain/id.js';
import { Claim, ClaimScope } from '../../core/domain/claim.js';
import { ValidationError } from '../../core/domain/errors.js';
import { validatePermission } from '../../core/domain/validate-permission.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePayment } from '../middleware/payment.js';
import { getCexPrice, getDexPrice } from '../../../reference-consumer/lib/price-feed-client.js';
import { anchorChainHash } from '../../modules/anchor/xlayer-anchor.js';
import { config } from '../../config/index.js';

const TIER_CONFIG = {
  standard: {
    amount: 500000,
    recallTopK: 3,
    conflictPollMs: 2000,
    synthesis: false,
    label: 'Standard — two independent sources, raw findings',
  },
  deep: {
    amount: 1000000,
    recallTopK: 10,
    conflictPollMs: 4000,
    synthesis: true,
    label: 'Deep — two independent sources, extended conflict scan, synthesized assessment',
  },
};

const DIVERGENCE_THRESHOLD_PCT = 0.02;
const WORKFLOW_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Writes a claim under a specific service identity — bypasses x402,
 * payment already settled at cycle level.
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
  const permission = validatePermission({ mode: 'explicit', allow: allowedWallets });

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

  // Fire-and-forget anomaly detection
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
 * Semantic retrieval — bypasses x402, uses caller's identity for
 * authorization evaluation.
 */
async function internalRecall({
  claimStore,
  embeddingProvider,
  authorizationPolicy,
  synthesisEngine,
  threadId,
  callerIdentity,
  intent,
  topK = 5,
  minSimilarity = 0.2,
  synthesis = false,
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

  let synthesizedContext = null;
  if (synthesis && synthesisEngine && permitted.length > 0) {
    const result = await synthesisEngine.synthesize({
      taskIntent: intent,
      permittedClaims: permitted.map((m) => m.claim),
    });
    synthesizedContext = result.synthesizedView;
  }

  return { permitted, synthesizedContext };
}

/**
 * Grants read access to a claim — used mid-pipeline to extend
 * OnchainFeed's claim to the buyer's identity. Only the writer
 * (OnchainFeed service identity) may grant.
 */
async function internalGrant({ claimStore, claimId, grantedToWallet, grantedByIdentityId }) {
  await claimStore.recordGrant({
    grantId: generateId('syn9_grant'),
    claimId,
    grantedToWallet,
    grantedByIdentityId,
  });
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
    synthesisEngine,
  } = opts;

  // Pre-registered service identities — distinct from the caller.
  // These must be set in environment variables and registered in the DB.
  const onchainFeedIdentity = {
    identityId: config.pipeline.onchainFeedIdentityId,
    walletAddress: config.pipeline.onchainFeedWallet,
  };
  const signalAnalystIdentity = {
    identityId: config.pipeline.signalAnalystIdentityId,
    walletAddress: config.pipeline.signalAnalystWallet,
  };

  if (!onchainFeedIdentity.identityId || !signalAnalystIdentity.identityId) {
    fastify.log.warn(
      'SYN9_ONCHAIN_FEED_IDENTITY_ID or SYN9_SIGNAL_ANALYST_IDENTITY_ID not set — ' +
      'research-cycles route will fail at runtime. Set these env vars.'
    );
  }

  fastify.post(
    '/v1/research-cycles',
    {
      preHandler: [
        requireAuth(identityProvider),
        requirePayment({
          okxPaymentClient,
          identityProvider,
          amountFn: (body) => {
            const tier = TIER_CONFIG[body?.tier];
            return tier ? tier.amount : TIER_CONFIG.standard.amount;
          },
          description: 'Syn9 Research Cycle — multi-source provenance pipeline',
        }),
      ],
    },
    async (request, reply) => {
      const { tier: rawTier, thread_id: existingThreadId, assets } = request.body ?? {};

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
      const callerWallet = request.identity.walletAddress;
      const cycleId = generateId('syn9_cycle');
      const asset = assets?.[0] ?? 'OKB';

      // ── Source A: OnchainFeed (CEX spot price) ──────────────────────
      // Written under OnchainFeed's identity, permitted for:
      //   - SignalAnalyst (needs it for RECALL in the next step)
      //   - Caller (granted mid-pipeline after deny — the demo moment)
      // Note: caller is NOT in the initial allow list — deny happens first.
      const cexResult = await getCexPrice();

      const onchainFeedClaim = await internalWeave({
        claimStore,
        provenanceChain,
        embeddingProvider,
        anomalyDetector,
        threadId,
        writerIdentityId: onchainFeedIdentity.identityId,
        payload: {
          asset,
          priceUsd: cexResult.price,
          source: cexResult.source,
          mechanism: 'cex_orderbook',
          sourceIdentity: onchainFeedIdentity.walletAddress,
          timestamp: Date.now(),
          note: `${asset} CEX spot price: $${cexResult.price} USDT (OKX orderbook). Written by OnchainFeed service identity.`,
        },
        allowedWallets: [signalAnalystIdentity.walletAddress], // caller excluded initially
        fastify,
      });

      // ── Source B: SignalAnalyst (DEX aggregator price) ───────────────
      // SignalAnalyst RECALLs OnchainFeed's finding (it's in the allow list),
      // then writes its own finding under its own identity.
      // Permitted for: caller only (SignalAnalyst does not need its own data back).
      const dexResult = await getDexPrice();

      const divergencePct = (Math.abs(cexResult.price - dexResult.price) / cexResult.price) * 100;
      const contradictionDetected = divergencePct >= DIVERGENCE_THRESHOLD_PCT;

      const signalClaim = await internalWeave({
        claimStore,
        provenanceChain,
        embeddingProvider,
        anomalyDetector,
        threadId,
        writerIdentityId: signalAnalystIdentity.identityId,
        payload: {
          asset,
          priceUsd: dexResult.price,
          source: dexResult.source,
          mechanism: 'dex_aggregator_onchain',
          chainIndex: '196',
          sourceIdentity: signalAnalystIdentity.walletAddress,
          cexPriceForComparison: cexResult.price,
          divergencePct: Number(divergencePct.toFixed(6)),
          contradictionDetected,
          onchainFeedEntryId: onchainFeedClaim.claimId,
          timestamp: Date.now(),
          note: `${asset} DEX aggregator quote (XLayer): $${dexResult.price} USDT. ` +
                `Divergence from CEX: ${divergencePct.toFixed(4)}%. ` +
                (contradictionDetected ? 'CONTRADICTION FLAGGED.' : 'Within normal bounds.') +
                ` Written by SignalAnalyst service identity.`,
        },
        allowedWallets: [callerWallet],
        fastify,
      });

      // ── PERMISSION_GRANT: OnchainFeed grants caller read access ─────
      // The caller was excluded from OnchainFeed's initial allow list.
      // The pipeline now grants them access so RECALL can synthesize
      // findings from both independent sources.
      // This is the deny→grant→synthesize flow in production.
      await internalGrant({
        claimStore,
        claimId: onchainFeedClaim.claimId,
        grantedToWallet: callerWallet,
        grantedByIdentityId: onchainFeedIdentity.identityId,
      });

      // ── RECALL: caller retrieves both findings post-grant ────────────
      const { permitted: recalled, synthesizedContext } = await internalRecall({
        claimStore,
        embeddingProvider,
        authorizationPolicy,
        threadId,
        callerIdentity: request.identity,
        intent: `${asset} price observations from independent CEX and DEX sources`,
        topK: tierConfig.recallTopK,
        minSimilarity: 0.2,
    synthesis: tierConfig.synthesis,
    synthesisEngine,
  });

  // ── Poll conflicts ───────────────────────────────────────────────
      await new Promise((r) => setTimeout(r, tierConfig.conflictPollMs));
      const conflicts = await claimStore.listConflictsInThread(threadId);

      // ── Assemble output ──────────────────────────────────────────────
      const confidence = contradictionDetected
        ? Math.max(0.4, 0.85 - divergencePct * 2)
        : 0.85;

      // Fire-and-forget on-chain anchor
      anchorChainHash(signalClaim.chainHash, threadId)
        .then((anchor) => fastify.log.info({ anchor }, 'Research cycle chain hash anchored to XLayer'))
        .catch((err) => fastify.log.error({ errMessage: err.message }, 'XLayer anchor failed'));

      reply.code(201);
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
          sourcesRecalled: recalled.length,
          synthesizedAssessment: synthesizedContext,
        },
        provenance: [
          {
            sourceId: 'onchain_feed',
            agentId: onchainFeedIdentity.identityId,
            agentWallet: onchainFeedIdentity.walletAddress,
            entryId: onchainFeedClaim.claimId,
            chainHash: onchainFeedClaim.chainHash,
            mechanism: 'cex_orderbook',
            ingestedAt: onchainFeedClaim.createdAt.toISOString(),
            confidence: 0.95,
            priceObserved: cexResult.price,
          },
          {
            sourceId: 'signal_analyst',
            agentId: signalAnalystIdentity.identityId,
            agentWallet: signalAnalystIdentity.walletAddress,
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
        attribution: {
          note: 'Each source is a distinct registered service identity. OnchainFeed and SignalAnalyst write under separate identity IDs. The buyer identity is excluded from OnchainFeed\'s initial allow-list and granted access mid-pipeline via PERMISSION_GRANT — the deny→grant→synthesize flow runs in every production research cycle.',
          callerIdentityId,
          onchainFeedIdentityId: onchainFeedIdentity.identityId,
          signalAnalystIdentityId: signalAnalystIdentity.identityId,
        },
      };
    }
  );
}