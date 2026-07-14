/**
 * Risk Scoring Agent — RECALLs the Research Agent's finding, applies a
 * deterministic scoring rubric (no LLM — fast, auditable, reproducible
 * per the blueprint's explicit design), WEAVEs the score with explicit
 * permission for Agent 3 only.
 */

/**
 * Deterministic risk rubric. Real logic, not a placeholder — scores
 * based on actual on-chain activity signals from the research data.
 */
function scoreRisk(addressData) {
  let score = 50; // baseline
  const factors = [];

  const txCount = Number(addressData.transactionCount);
  if (txCount === 0) {
    score += 30;
    factors.push('No on-chain transaction history (+30 risk)');
  } else if (txCount < 5) {
    score += 15;
    factors.push('Very low transaction count (+15 risk)');
  } else {
    score -= 10;
    factors.push('Established transaction history (-10 risk)');
  }

  const isContract = addressData.contractAddress === true || addressData.contractAddress === 'true';
  if (isContract && !addressData.contractCorrespondingToken) {
    score += 10;
    factors.push('Unverified/unlabeled contract (+10 risk)');
  }

  if (!addressData.lastTransactionTime) {
    score += 10;
    factors.push('No recorded activity timestamp (+10 risk)');
  }

  score = Math.max(0, Math.min(100, score));
  const level = score >= 70 ? 'HIGH' : score >= 40 ? 'MEDIUM' : 'LOW';

  return { score, level, factors };
}

export async function runRiskAgent({ agent, threadId, agent3WalletAddress }) {
  const { status: recallStatus, body: recallBody } = await agent.recall(threadId, {
    intent: 'on-chain research findings for the subject wallet',
    minSimilarity: 0.2,
    topK: 1,
  });

  if (recallStatus !== 200 || recallBody.results.length === 0) {
    throw new Error(`Risk agent could not RECALL research findings: ${JSON.stringify(recallBody)}`);
  }

  const researchClaim = recallBody.results[0];
  const addressData = researchClaim.payload.rawData;

  const { score, level, factors } = scoreRisk(addressData);

  const note = [
    `Risk assessment for wallet ${researchClaim.payload.subjectWallet}:`,
    `- Score: ${score}/100 (${level})`,
    `- Factors:`,
    ...factors.map((f) => `  - ${f}`),
    `- Based on research entry: ${researchClaim.entry_id}`,
  ].join('\n');

  const { status: weaveStatus, body: weaveBody } = await agent.weave(threadId, {
    payload: {
      subjectWallet: researchClaim.payload.subjectWallet,
      score,
      level,
      factors,
      note,
      sourceResearchEntryId: researchClaim.entry_id,
    },
    permissions: { mode: 'explicit', allow: [agent3WalletAddress] },
    scope: 'workflow',
  });

  if (weaveStatus !== 201) {
    throw new Error(`Risk agent WEAVE failed: ${JSON.stringify(weaveBody)}`);
  }

  return { entryId: weaveBody.entry_id, chainHash: weaveBody.chain_hash, score, level, factors };
}