// src/api/routes/research-endpoint.js
//
// GET+POST /v1/research
//
// Dedicated marketplace listing endpoint for the Syn9 Research Cycle service.
// OKX's x402-check tool probes this URL to verify the service fee matches
// the listed price (0.50 USDT). Both GET and POST return 402 with the
// correct challenge amount so the validator sees the right fee.
//
// POST /v1/research with a valid payment and auth header runs the full
// research cycle pipeline — same logic as /v1/research-cycles, aliased
// here so the marketplace listing endpoint and the operation endpoint
// are the same URL. This eliminates the fee mismatch the OKX reviewer
// flagged (root URL quoted 0.002, Research Cycle listed at 0.50).

import { requirePayment } from '../middleware/payment.js';
import { requireAuth } from '../middleware/auth.js';
import { getCexPrice, getDexPrice } from '../../../reference-consumer/lib/price-feed-client.js';
import { anchorChainHash } from '../../modules/anchor/xlayer-anchor.js';
import { generateId } from '../../core/domain/id.js';
import { Claim, ClaimScope } from '../../core/domain/claim.js';
import { ValidationError } from '../../core/domain/errors.js';
import { validatePermission } from '../../core/domain/validate-permission.js';
import { randomUUID } from 'node:crypto';
import { config } from '../../config/index.js';

const DIVERGENCE_THRESHOLD_PCT = 0.02;
const WORKFLOW_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SERVICE_AMOUNT = 500000; // $0.50 USDT — matches Research Cycle listing fee

async function internalWeave({ claimStore, provenanceChain, embeddingProvider, anomalyDetector, threadId, writerIdentityId, payload, allowedWallets, fastify }) {
  const claimId = generateId('syn9_claim');
  const payloadHash = provenanceChain.hashPayload(payload);
  const timestamp = new Date();
  const embedding = await embeddingProvider.embed({ text: JSON.stringify(payload), taskType: 'document' });
  const latestClaim = await claimStore.getLatestInThread(threadId);
  const prevHash = latestClaim ? latestClaim.chainHash : null;
  const chainHash = provenanceChain.computeHash({ prevHash, claimId, payloadHash, timestamp: timestamp.toISOString(), writerIdentityId });
  const expiresAt = new Date(timestamp.getTime() + WORKFLOW_TTL_MS);
  const permission = validatePermission({ mode: 'explicit', allow: allowedWallets });
  const claim = new Claim({ claimId, threadId, writerIdentityId, payload, payloadHash, embedding, permission, scope: ClaimScope.WORKFLOW, chainHash, prevHash, createdAt: timestamp, expiresAt });
  const stored = await claimStore.append(claim);
  const recentClaims = await claimStore.getRecentInThread(threadId, 20);
  anomalyDetector.detect({ newClaim: stored, recentClaims })
    .then(async (conflict) => { if (conflict) await claimStore.recordConflict(conflict); })
    .catch((err) => fastify.log.error({ errMessage: err.message }, 'Research endpoint anomaly detection failed'));
  return stored;
}

export default async function researchEndpointRoutes(fastify, opts) {
  const { claimStore, provenanceChain, embeddingProvider, anomalyDetector, identityProvider, authorizationPolicy, synthesisEngine, okxPaymentClient } = opts;

  const onchainFeedIdentity = {
    identityId: config.pipeline.onchainFeedIdentityId,
    walletAddress: config.pipeline.onchainFeedWallet,
  };
  const signalAnalystIdentity = {
    identityId: config.pipeline.signalAnalystIdentityId,
    walletAddress: config.pipeline.signalAnalystWallet,
  };

  const paymentGate = requirePayment({
    okxPaymentClient,
    identityProvider,
    amountFn: () => SERVICE_AMOUNT,
    description: 'Syn9 Research Cycle — multi-source provenance pipeline ($0.50)',
  });

  // GET — probed by OKX x402-check validator
  fastify.get('/v1/research', { preHandler: paymentGate }, async () => {
    return {
      service: 'Syn9 Research Cycle',
      description: 'Multi-source research pipeline with cryptographic provenance.',
      example: {
        request: { assets: ['OKB'] },
        response: {
          opportunity: { asset: 'OKB', cexPriceUsd: 82.13, dexPriceUsd: 82.05, contradictionDetected: true, recommendation: 'INVESTIGATE' },
          provenance: [{ sourceId: 'onchain_feed', entryId: 'syn9_claim_...', chainHash: '0x...' }, { sourceId: 'signal_analyst', entryId: 'syn9_claim_...', chainHash: '0x...' }],
          contradictions: [{ summary: 'Claim A states price is $82.05, Claim B states $82.13.', similarity_score: 0.93 }],
        },
      },
      setup: 'POST /v1/provision with your wallet address and EIP-191 signature to get credentials.',
    };
  });

  // POST — runs the full research cycle
  fastify.post(
    '/v1/research',
    { preHandler: [paymentGate, requireAuth(identityProvider)] },
    async (request, reply) => {
      const { assets, thread_id: existingThreadId } = request.body ?? {};

      if (assets !== undefined && (!Array.isArray(assets) || assets.length === 0)) {
        throw new ValidationError('assets must be a non-empty array if provided');
      }

      const threadId = existingThreadId ?? randomUUID();
      const callerIdentityId = request.identity.identityId;
      const callerWallet = request.identity.walletAddress;
      const cycleId = generateId('syn9_cycle');
      const asset = assets?.[0] ?? 'OKB';

      // Source A: CEX spot price (OnchainFeed identity)
      const cexResult = await getCexPrice();
      const onchainFeedClaim = await internalWeave({
        claimStore, provenanceChain, embeddingProvider, anomalyDetector, threadId,
        writerIdentityId: onchainFeedIdentity.identityId,
        payload: { asset, priceUsd: cexResult.price, source: cexResult.source, mechanism: 'cex_orderbook', sourceIdentity: onchainFeedIdentity.walletAddress, timestamp: Date.now() },
        allowedWallets: [signalAnalystIdentity.walletAddress],
        fastify,
      });

      // Source B: DEX aggregator price (SignalAnalyst identity)
      const dexResult = await getDexPrice();
      const divergencePct = (Math.abs(cexResult.price - dexResult.price) / cexResult.price) * 100;
      const contradictionDetected = divergencePct >= DIVERGENCE_THRESHOLD_PCT;

      const signalClaim = await internalWeave({
        claimStore, provenanceChain, embeddingProvider, anomalyDetector, threadId,
        writerIdentityId: signalAnalystIdentity.identityId,
        payload: { asset, priceUsd: dexResult.price, source: dexResult.source, mechanism: 'dex_aggregator_onchain', chainIndex: '196', sourceIdentity: signalAnalystIdentity.walletAddress, cexPriceForComparison: cexResult.price, divergencePct: Number(divergencePct.toFixed(6)), contradictionDetected, timestamp: Date.now() },
        allowedWallets: [callerWallet],
        fastify,
      });

      // Grant caller access to OnchainFeed's claim
      await claimStore.recordGrant({
        grantId: generateId('syn9_grant'),
        claimId: onchainFeedClaim.claimId,
        grantedToWallet: callerWallet,
        grantedByIdentityId: onchainFeedIdentity.identityId,
      });

      // Poll conflicts
      await new Promise((r) => setTimeout(r, 2000));
      const conflicts = await claimStore.listConflictsInThread(threadId);

      const confidence = contradictionDetected ? Math.max(0.4, 0.85 - divergencePct * 2) : 0.85;

      // Fire-and-forget anchor
      anchorChainHash(signalClaim.chainHash, threadId)
        .then((anchor) => fastify.log.info({ anchor }, 'Research endpoint chain hash anchored'))
        .catch((err) => fastify.log.error({ errMessage: err.message }, 'XLayer anchor failed'));

      reply.code(201);
      return {
        cycle_id: cycleId,
        thread_id: threadId,
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
          { sourceId: 'onchain_feed', agentId: onchainFeedIdentity.identityId, entryId: onchainFeedClaim.claimId, chainHash: onchainFeedClaim.chainHash, mechanism: 'cex_orderbook', ingestedAt: onchainFeedClaim.createdAt.toISOString(), confidence: 0.95, priceObserved: cexResult.price },
          { sourceId: 'signal_analyst', agentId: signalAnalystIdentity.identityId, entryId: signalClaim.claimId, chainHash: signalClaim.chainHash, mechanism: 'dex_aggregator_onchain', ingestedAt: signalClaim.createdAt.toISOString(), confidence: 0.92, priceObserved: dexResult.price },
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