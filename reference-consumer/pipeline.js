import { randomUUID } from 'node:crypto';
import { Syn9Agent } from './lib/syn9-client.js';
import { runResearchAgent } from './agents/research-agent.js';
import { runRiskAgent } from './agents/risk-agent.js';
import { runReportAgent } from './agents/report-agent.js';

/**
 * Reference consumer pipeline — three real, distinct Syn9 identities
 * exercising WEAVE, RECALL, PERMISSION_GRANT, synthesis, and the
 * PERMISSION_DENIED demo moment end-to-end against the real deployed
 * Syn9 API.
 *
 * Subject wallet is Syn9's own registered Agentic Wallet — a real,
 * known XLayer address, giving deterministic, real on-chain data.
 */
const SUBJECT_WALLET = '0x929f42eacc298afa6febc3d6a869fcf8e0ca37cb';

function estimateTokens(obj) {
  // Rough token estimate: ~4 chars per token, standard approximation.
  return Math.ceil(JSON.stringify(obj).length / 4);
}

async function main() {
  const threadId = randomUUID();
  console.log(`\n=== Syn9 Reference Consumer Pipeline ===`);
  console.log(`Thread: ${threadId}\n`);

  console.log('Registering three distinct agent identities...');
  const researchAgent = await Syn9Agent.register('ResearchAgent', '0xResearch' + Date.now());
  const riskAgent = await Syn9Agent.register('RiskAgent', '0xRisk' + (Date.now() + 1));
  const reportAgent = await Syn9Agent.register('ReportAgent', '0xReport' + (Date.now() + 2));
  console.log(`  Research: ${researchAgent.walletAddress}`);
  console.log(`  Risk:     ${riskAgent.walletAddress}`);
  console.log(`  Report:   ${reportAgent.walletAddress}\n`);

  console.log('--- Agent 1: Research (real on-chain data via XLayer API) ---');
  const research = await runResearchAgent({
    agent: researchAgent,
    threadId,
    subjectWallet: SUBJECT_WALLET,
    agent2WalletAddress: riskAgent.walletAddress,
  });
  console.log(`  WEAVE succeeded: ${research.entryId}`);
  console.log(`  chain_hash: ${research.chainHash}\n`);

  console.log('--- Agent 2: Risk Scoring (deterministic rubric) ---');
  const risk = await runRiskAgent({
    agent: riskAgent,
    threadId,
    agent3WalletAddress: reportAgent.walletAddress,
  });
  console.log(`  Score: ${risk.score}/100 (${risk.level})`);
  console.log(`  WEAVE succeeded: ${risk.entryId}\n`);

  console.log('--- Agent 3: Report — attempting RECALL of research (should be DENIED) ---');
  const deniedAttempt = await reportAgent.recall(threadId, {
    intent: 'raw on-chain research findings for the subject wallet',
    minSimilarity: 0.2,
    topK: 1,
  });
  console.log(`  Status: ${deniedAttempt.status}`);
  console.log(`  Body: ${JSON.stringify(deniedAttempt.body)}`);
  const correctlyDenied = deniedAttempt.status === 403 && deniedAttempt.body.error === 'PERMISSION_DENIED';
  console.log(`  ✓ Correctly denied with no content leak: ${correctlyDenied}\n`);

  console.log('--- Orchestrator: PERMISSION_GRANT (Agent 1 grants Agent 3 access) ---');
  const grant = await researchAgent.grant(threadId, research.entryId, reportAgent.walletAddress);
  console.log(`  Status: ${grant.status}`);
  console.log(`  Grant ID: ${grant.body.grant_id}\n`);

  console.log('--- Agent 3: Report — retrying RECALL with synthesis (should succeed) ---');
  const permitted = await reportAgent.recall(threadId, {
    intent: 'raw on-chain research findings for the subject wallet',
    synthesis: true,
    minSimilarity: 0.2,
    topK: 1,
  });
  console.log(`  Status: ${permitted.status}`);
  console.log(`  Synthesized: ${permitted.body.synthesized_context}\n`);

  console.log('--- Agent 3: assembling final report ---');
  const riskRecall = await reportAgent.recall(threadId, {
    intent: 'risk score and factors for the subject wallet',
    minSimilarity: 0.2,
    topK: 1,
  });
  const riskData = riskRecall.body.results[0].payload;

  const finalReport = [
    `=== Syn9 Reference Consumer: Due Diligence Report ===`,
    `Subject: ${riskData.subjectWallet}`,
    `Risk level: ${riskData.level} (${riskData.score}/100)`,
    `Research summary (synthesized): ${permitted.body.synthesized_context}`,
    `Risk factors:`,
    ...riskData.factors.map((f) => `  - ${f}`),
  ].join('\n');

  console.log(finalReport);

  // Token-cost comparison per blueprint's demo script
  const naiveReinjectionTokens = estimateTokens(research) + estimateTokens(risk) + estimateTokens(research) + estimateTokens(risk);
  const syn9ActualTokens = estimateTokens(deniedAttempt.body) + estimateTokens(grant.body) + estimateTokens(permitted.body.synthesized_context) + estimateTokens(riskData);

  console.log(`\n=== Token Cost Comparison ===`);
  console.log(`  Naive full re-injection (estimated): ~${naiveReinjectionTokens} tokens`);
  console.log(`  Syn9 selective retrieval (actual):    ~${syn9ActualTokens} tokens`);
  console.log(`  Reduction: ~${Math.round((1 - syn9ActualTokens / naiveReinjectionTokens) * 100)}%`);

  console.log(`\n=== Pipeline complete. Thread: ${threadId} ===`);
}

main().catch((err) => {
  console.error('Pipeline failed:', err);
  process.exit(1);
});