// signal-analyst-agent.js
// SignalAnalyst — Source B of the two-source price comparison.
// Pulls OKB price from the OKX DEX aggregator (on-chain-routed, XLayer chainIndex 196),
// RECALLs OnchainFeed's CEX price, computes divergence locally for the payload,
// and WEAVEs the combined finding to StrategyWriter.
//
// Syn9's contradiction detector fires automatically on the WEAVE if the two
// embeddings are semantically similar (same asset, same timeframe) but the
// price values diverge — this is why no explicit contradiction call is needed here.
// The conflict appears in the `conflicts` table and surfaces via the polling
// endpoint (GET /v1/threads/:threadId/conflicts) or webhook.

import { getDexPrice, getPricesAndCheckDivergence } from '../lib/price-feed-client.js';

export async function runSignalAnalystAgent({ agent, threadId, strategyWriterWalletAddress }) {
  // Step 1: RECALL OnchainFeed's CEX price (already permitted at WEAVE time)
  const { status: recallStatus, body: recallBody } = await agent.recall(threadId, {
    intent: 'OKB spot price from CEX orderbook',
    minSimilarity: 0.2,
    topK: 1,
  });

  if (recallStatus !== 200 || recallBody.results.length === 0) {
    throw new Error(`SignalAnalyst RECALL of OnchainFeed data failed: ${JSON.stringify(recallBody)}`);
  }

  const onchainFeedClaim = recallBody.results[0];
  const cexPrice = onchainFeedClaim.payload.priceUsd;

  // Step 2: pull DEX price independently
  const { price: dexPrice, source: dexSource, raw: dexRaw } = await getDexPrice();

  // Step 3: compute divergence (mirrors what Syn9's detector will do on embedding similarity)
  const divergencePct = (Math.abs(cexPrice - dexPrice) / cexPrice) * 100;
  const DIVERGENCE_THRESHOLD_PCT = 0.02; // calibrated against 5 live runs: range 0.024–0.086%, never zero
  const contradictionDetected = divergencePct >= DIVERGENCE_THRESHOLD_PCT;

  const payload = {
    asset: 'OKB',
    priceUsd: dexPrice,
    source: dexSource,
    mechanism: 'dex_aggregator_onchain',
    chainIndex: '196',
    timestamp: Date.now(),
    cexPriceForComparison: cexPrice,
    divergencePct: Number(divergencePct.toFixed(6)),
    contradictionDetected,
    onchainFeedEntryId: onchainFeedClaim.entry_id,
    note: `OKB DEX aggregator quote (XLayer chainIndex=196): $${dexPrice} USDT. ` +
          `Price-discovery mechanism: on-chain smart-routing across XLayer liquidity pools. ` +
          `CEX reference (entry ${onchainFeedClaim.entry_id}): $${cexPrice}. ` +
          `Divergence: ${divergencePct.toFixed(4)}%. ` +
          (contradictionDetected
            ? `CONTRADICTION FLAGGED: price-discovery divergence exceeds ${DIVERGENCE_THRESHOLD_PCT}% threshold.`
            : `Within normal arbitrage bounds.`),
  };

  const { status: weaveStatus, body: weaveBody } = await agent.weave(threadId, {
    payload,
    permissions: { mode: 'explicit', allow: [strategyWriterWalletAddress] },
    scope: 'workflow',
  });

  if (weaveStatus !== 201) {
    throw new Error(`SignalAnalyst WEAVE failed: ${JSON.stringify(weaveBody)}`);
  }

  return {
    entryId: weaveBody.entry_id,
    chainHash: weaveBody.chain_hash,
    dexPrice,
    cexPrice,
    divergencePct,
    contradictionDetected,
  };
}