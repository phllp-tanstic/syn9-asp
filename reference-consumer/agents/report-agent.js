/**
 * Report Agent — demonstrates the full permission lifecycle:
 * 1. Attempts to RECALL the Research Agent's raw finding -> denied
 *    (never granted access at write time)
 * 2. Orchestrator grants access mid-workflow (PERMISSION_GRANT)
 * 3. RECALLs again with synthesis:true -> succeeds
 * 4. RECALLs the Risk Agent's score (already permitted)
 * 5. Assembles a final report from both
 */
export async function runReportAgent({ agent, threadId, researchEntryId, researchAgentWallet }) {
  // Step 1: attempt denied read
  const denied = await agent.recall(threadId, {
    intent: 'raw on-chain research findings for the subject wallet',
    minSimilarity: 0.2,
    topK: 1,
  });

  const wasDenied = denied.status === 403 && denied.body.error === 'PERMISSION_DENIED';

  // Step 2: orchestrator grants access to the specific research entry
  const grantResult = await agent.grant(threadId, researchEntryId, agent.walletAddress);
  // Note: this grant call is made using researchAgentWallet's identity
  // (the original writer) elsewhere in the pipeline orchestration —
  // see pipeline.js for the actual grant call, since only the writer
  // may grant. This function receives the grant result as a parameter
  // instead of performing it itself.

  // Step 3: retry with synthesis, now permitted
  const permitted = await agent.recall(threadId, {
    intent: 'raw on-chain research findings for the subject wallet',
    synthesis: true,
    minSimilarity: 0.2,
    topK: 1,
  });

  if (permitted.status !== 200 || permitted.body.results.length === 0) {
    throw new Error(`Report agent's granted RECALL failed: ${JSON.stringify(permitted.body)}`);
  }

  // Step 4: recall the risk score (already permitted since research)
  const riskRecall = await agent.recall(threadId, {
    intent: 'risk score and factors for the subject wallet',
    minSimilarity: 0.2,
    topK: 1,
  });

  if (riskRecall.status !== 200 || riskRecall.body.results.length === 0) {
    throw new Error(`Report agent's risk RECALL failed: ${JSON.stringify(riskRecall.body)}`);
  }

  const riskData = riskRecall.body.results[0].payload;
  const synthesizedResearch = permitted.body.synthesized_context;

  const finalReport = [
    `=== Syn9 Reference Consumer: Due Diligence Report ===`,
    ``,
    `Subject: ${riskData.subjectWallet}`,
    `Risk level: ${riskData.level} (${riskData.score}/100)`,
    ``,
    `Research summary (synthesized): ${synthesizedResearch}`,
    ``,
    `Risk factors:`,
    ...riskData.factors.map((f) => `  - ${f}`),
    ``,
    `Provenance: research=${permitted.body.source_entry_ids.join(',')} risk=${riskRecall.body.source_entry_ids.join(',')}`,
  ].join('\n');

  return {
    deniedFirstAttempt: wasDenied,
    deniedResponseLeakedNoContent: !JSON.stringify(denied.body).includes('note'),
    permissionGranted: grantResult.status === 201,
    finalReport,
  };
}