import { XLayerDataClient } from '../lib/oklink-client.js';

/**
 * Research Agent — pulls real on-chain data for a subject wallet via
 * OKX's XLayer data API, produces a factual research note, WEAVEs it
 * to Syn9 with explicit permission for Agent 2 only.
 *
 * All findings are derived from genuinely queried on-chain data — no
 * fabricated or simulated figures.
 */
export async function runResearchAgent({ agent, threadId, subjectWallet, agent2WalletAddress }) {
  const dataClient = new XLayerDataClient();
  const info = await dataClient.getAddressInfo(subjectWallet);
  const addressData = info.data?.[0];

  if (!addressData) {
    throw new Error(`No on-chain data returned for ${subjectWallet}`);
  }

  const isContract = addressData.contractAddress === true || addressData.contractAddress === 'true';
  const txCount = Number(addressData.transactionCount);
  const hasActivity = txCount > 0;

  const note = [
    `On-chain research for wallet ${subjectWallet} (XLayer):`,
    `- Address type: ${isContract ? 'smart contract' : 'externally-owned account'}`,
    `- Transaction count: ${txCount}`,
    `- Balance: ${addressData.balance} ${addressData.balanceSymbol}`,
    `- Last transaction: ${addressData.lastTransactionTime ? new Date(Number(addressData.lastTransactionTime)).toISOString() : 'none recorded'}`,
    `- Activity assessment: ${hasActivity ? 'address has recorded on-chain activity' : 'no recorded on-chain activity — newly created or dormant address'}`,
  ].join('\n');

  const { status, body } = await agent.weave(threadId, {
    payload: { subjectWallet, note, rawData: addressData },
    permissions: { mode: 'explicit', allow: [agent2WalletAddress] },
    scope: 'workflow',
  });

  if (status !== 201) {
    throw new Error(`Research agent WEAVE failed: ${JSON.stringify(body)}`);
  }

  return { entryId: body.entry_id, chainHash: body.chain_hash, note, addressData };
}