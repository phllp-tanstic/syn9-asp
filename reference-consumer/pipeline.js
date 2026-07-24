// pipeline.js
// Syn9 DeFi Research Provenance Pipeline — three independent agents,
// two real price sources, one genuine contradiction detection demo.
//
// Flow:
//   OnchainFeed  → WEAVEs OKB CEX spot price (permitted: SignalAnalyst only)
//   SignalAnalyst → WEAVEs OKB DEX aggregator price + divergence (permitted: StrategyWriter only)
//                   Syn9 contradiction detector fires automatically if sources diverge
//   StrategyWriter → RECALL denied → PERMISSION_GRANT → RECALL+synthesis succeeds
//                    → structured { opportunity, provenance } output
//
// Every WEAVE/RECALL is payment-gated via x402 (real settlement, no mocks).

import { randomUUID } from 'node:crypto';
import { Syn9Agent } from './lib/syn9-client.js';
import { runOnchainFeedAgent } from './agents/onchain-feed-agent.js';
import { runSignalAnalystAgent } from './agents/signal-analyst-agent.js';
import { runStrategyWriterAgent } from './agents/strategy-writer-agent.js';

async function main() {
  const threadId = randomUUID();
  console.log(`\n=== Syn9 DeFi Research Provenance Pipeline ===`);
  console.log(`Thread: ${threadId}\n`);

  // --- Agent registration ---
  console.log('Registering three distinct agent identities...');
  const onchainFeedAgent = await Syn9Agent.register('OnchainFeed', '0xOnchain' + Date.now());
  const signalAnalystAgent = await Syn9Agent.register('SignalAnalyst', '0xSignal' + (Date.now() + 1));
  const strategyWriterAgent = await Syn9Agent.register('StrategyWriter', '0xStrategy' + (Date.now() + 2));
  console.log(`  OnchainFeed:    ${onchainFeedAgent.walletAddress}`);
  console.log(`  SignalAnalyst:  ${signalAnalystAgent.walletAddress}`);
  console.log(`  StrategyWriter: ${strategyWriterAgent.walletAddress}\n`);

  // --- OnchainFeed: CEX spot price ---
  console.log('--- OnchainFeed: OKB CEX spot price (OKX orderbook, no auth) ---');
  const onchainFeed = await runOnchainFeedAgent({
    agent: onchainFeedAgent,
    threadId,
    signalAnalystWalletAddress: signalAnalystAgent.walletAddress,
  });
  console.log(`  CEX price: $${onchainFeed.price}`);
  console.log(`  WEAVE entry: ${onchainFeed.entryId}`);
  console.log(`  chain_hash: ${onchainFeed.chainHash}\n`);

  // --- SignalAnalyst: DEX aggregator price + contradiction ---
  console.log('--- SignalAnalyst: OKB DEX aggregator price (XLayer on-chain routing) ---');
  const signalAnalyst = await runSignalAnalystAgent({
    agent: signalAnalystAgent,
    threadId,
    strategyWriterWalletAddress: strategyWriterAgent.walletAddress,
  });
  console.log(`  DEX price: $${signalAnalyst.dexPrice}`);
  console.log(`  CEX price (recalled): $${signalAnalyst.cexPrice}`);
  console.log(`  Divergence: ${signalAnalyst.divergencePct.toFixed(4)}%`);
  console.log(`  Contradiction flagged: ${signalAnalyst.contradictionDetected}`);
  console.log(`  WEAVE entry: ${signalAnalyst.entryId}`);
  console.log(`  chain_hash: ${signalAnalyst.chainHash}\n`);

  // --- StrategyWriter: RECALL denied → grant → synthesize ---
  console.log('--- StrategyWriter: attempting RECALL of OnchainFeed data (should be DENIED) ---');
  const deniedAttempt = await strategyWriterAgent.recall(threadId, {
    intent: 'OKB spot price from CEX orderbook raw finding',
    minSimilarity: 0.2,
    topK: 1,
  });
  const correctlyDenied = deniedAttempt.status === 403 && deniedAttempt.body.error === 'PERMISSION_DENIED';
  console.log(`  Status: ${deniedAttempt.status} — correctly denied: ${correctlyDenied}`);
  console.log(`  No content leak: ${!JSON.stringify(deniedAttempt.body).includes('priceUsd')}\n`);

  console.log('--- Orchestrator: PERMISSION_GRANT (OnchainFeed grants StrategyWriter access) ---');
  const grant = await onchainFeedAgent.grant(threadId, onchainFeed.entryId, strategyWriterAgent.walletAddress);
  if (grant.status !== 201) {
    throw new Error(`PERMISSION_GRANT failed: ${JSON.stringify(grant.body)}`);
  }
  console.log(`  Grant ID: ${grant.body.grant_id}\n`);

  console.log('--- StrategyWriter: assembling provenance-backed opportunity brief ---');
  const result = await runStrategyWriterAgent({
  agent: strategyWriterAgent,
  threadId,
  wasDenied: correctlyDenied,
  noContentLeak: !JSON.stringify(deniedAttempt.body).includes('priceUsd'),
  });

  console.log(`  Denied first attempt: ${result.wasDenied}`);
  console.log(`  No content leaked on deny: ${result.noContentLeak}`);
  console.log(`  Contradiction detected: ${result.contradictionDetected}\n`);

  console.log('=== STRUCTURED OUTPUT ===');
  console.log(JSON.stringify(result.output, null, 2));

  // --- Contradiction conflicts check ---
  // Give Syn9's fire-and-forget detector a moment to write to conflicts table,
  // then poll for any registered conflicts on this thread.
  console.log('\n--- Polling for Syn9 contradiction conflicts on this thread ---');
  await new Promise((r) => setTimeout(r, 2000));
  const conflictsRes = await signalAnalystAgent.getConflicts(threadId);
  if (conflictsRes.status === 200 && conflictsRes.body.conflicts?.length > 0) {
    console.log(`  Syn9 registered ${conflictsRes.body.conflicts.length} conflict(s):`);
    for (const c of conflictsRes.body.conflicts) {
      console.log(`    - ${c.conflict_id}: entries ${c.claim_id} vs ${c.conflicts_with_claim_id} (score: ${c.similarity_score})`);
      console.log(`      Summary: ${c.summary}`);
      console.log(`      Status: ${c.status} | Detected: ${c.detected_at}`);
    }
  } else {
    console.log(`  No conflicts registered on thread ${threadId} (detector may still be processing, or divergence below embedding similarity threshold)`);
  }

  console.log(`\n=== Pipeline complete. Thread: ${threadId} ===`);
}

main().catch((err) => {
  console.error('Pipeline failed:', err);
  process.exit(1);
});