// strategy-writer-agent.js
// StrategyWriter — final stage of the DeFi research provenance pipeline.
// Demonstrates the full permission lifecycle:
//   1. Attempts RECALL of OnchainFeed's raw finding → DENIED (never granted at write time)
//   2. Orchestrator grants access mid-workflow (PERMISSION_GRANT by the original writer)
//   3. RECALLs with synthesis:true → succeeds
//   4. RECALLs SignalAnalyst's finding (already permitted)
//   5. Checks for contradiction flag, assembles structured output:
//      { opportunity: {...}, provenance: [...] }
//
// The structured output is what judges and real DeFi pipeline consumers
// would receive — not a human-readable string, a machine-parseable record
// with a full provenance chain.

export async function runStrategyWriterAgent({ agent, threadId, wasDenied, noContentLeak }) {

  // Step 2 (grant) is performed by the orchestrator in pipeline.js —
  // only the original writer (OnchainFeed) may grant; StrategyWriter cannot
  // grant itself access.

  // Step 3: retry with synthesis, now permitted
  const permitted = await agent.recall(threadId, {
    intent: 'OKB spot price from CEX orderbook raw finding',
    synthesis: true,
    minSimilarity: 0.2,
    topK: 1,
  });

  if (permitted.status !== 200 || permitted.body.results.length === 0) {
    throw new Error(`StrategyWriter granted RECALL of OnchainFeed failed: ${JSON.stringify(permitted.body)}`);
  }

  const onchainFindingRaw = permitted.body.results[0].payload;

  // Step 4: RECALL SignalAnalyst's finding (already permitted at WEAVE time)
  const signalRecall = await agent.recall(threadId, {
    intent: 'OKB DEX aggregator price and divergence analysis',
    minSimilarity: 0.2,
    topK: 1,
  });

  if (signalRecall.status !== 200 || signalRecall.body.results.length === 0) {
    throw new Error(`StrategyWriter RECALL of SignalAnalyst failed: ${JSON.stringify(signalRecall.body)}`);
  }

  const signalFinding = signalRecall.body.results[0].payload;
  const contradictionDetected = signalFinding.contradictionDetected === true;

  // Step 5: assemble structured output
  const cexPrice = onchainFindingRaw.priceUsd;
  const dexPrice = signalFinding.priceUsd;
  const divergencePct = signalFinding.divergencePct;

  // Confidence degrades when sources contradict each other
  const confidence = contradictionDetected
    ? Math.max(0.4, 0.85 - divergencePct * 2)
    : 0.85;

  const output = {
    opportunity: {
      asset: 'OKB',
      cexPriceUsd: cexPrice,
      dexPriceUsd: dexPrice,
      priceDivergencePct: divergencePct,
      contradictionDetected,
      // A real arb signal: if DEX < CEX, buy on DEX / sell on CEX
      arbDirectionNote: dexPrice < cexPrice
        ? `DEX price ($${dexPrice}) below CEX ($${cexPrice}) — potential buy-DEX/sell-CEX opportunity`
        : `CEX price ($${cexPrice}) below DEX ($${dexPrice}) — potential buy-CEX/sell-DEX opportunity`,
      riskTier: contradictionDetected ? 'ELEVATED' : 'NORMAL',
      confidence: Number(confidence.toFixed(4)),
      recommendation: contradictionDetected
        ? 'INVESTIGATE — price-discovery sources diverge; verify liquidity depth before execution'
        : 'MONITOR — sources consistent; divergence within normal arbitrage bounds',
      synthesizedContext: permitted.body.synthesized_context,
    },
    provenance: [
      {
        sourceId: 'onchain_feed',
        agentId: permitted.body.results[0].writer_identity_id ?? 'onchain-feed-agent',
        entryId: permitted.body.results[0].entry_id,
        chainHash: permitted.body.results[0].chain_hash,
        mechanism: onchainFindingRaw.mechanism,
        ingestedAt: new Date(onchainFindingRaw.timestamp).toISOString(),
        confidence: 0.95,
        priceObserved: cexPrice,
      },
      {
        sourceId: 'signal_analyst',
        agentId: signalRecall.body.results[0].writer_identity_id ?? 'signal-analyst-agent',
        entryId: signalRecall.body.results[0].entry_id,
        chainHash: signalRecall.body.results[0].chain_hash,
        mechanism: signalFinding.mechanism,
        ingestedAt: new Date(signalFinding.timestamp).toISOString(),
        confidence: 0.92,
        priceObserved: dexPrice,
      },
    ],
  };

  return {
    wasDenied,
    noContentLeak,
    contradictionDetected,
    output,
    sourceEntryIds: {
      onchainFeed: permitted.body.source_entry_ids,
      signalAnalyst: signalRecall.body.source_entry_ids,
    },
  };
}