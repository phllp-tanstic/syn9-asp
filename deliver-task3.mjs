// Simulate real buyer flow: same wallet pays for both WEAVE and RECALL
// In production, the x402 payer wallet becomes the identity
// Our test uses Syn9Agent which handles payment via onchainos CLI

import { Syn9Agent } from './reference-consumer/lib/syn9-client.js';
import { randomUUID } from 'node:crypto';

// Register with a real EVM wallet format
const BUYER_WALLET = '0xff' + 'f'.repeat(38);
const agent = await Syn9Agent.register('BuyerAgent', BUYER_WALLET);
const threadId = randomUUID();

console.log('Buyer wallet:', agent.walletAddress);

// WEAVE — allowed_wallets set to buyer's wallet
const weave = await agent.weave(threadId, {
  payload: { tag: 'price-notes', note: 'OKB is trading around 50 USD as of today', timestamp: new Date().toISOString() },
  permissions: { mode: 'explicit', allow: [agent.walletAddress] },
  scope: 'workflow',
});
console.log('WEAVE entry_id:', weave.body.entry_id);
console.log('WEAVE chain_hash:', weave.body.chain_hash);

// Wait for embedding
await new Promise(r => setTimeout(r, 2000));

// RECALL — same agent, same wallet
const recall = await agent.recall(threadId, {
  intent: 'OKB price',
  minSimilarity: 0.2,
  topK: 1,
});
console.log('RECALL status:', recall.status);
console.log('RECALL results:', recall.body.results?.length ?? 0);
if (recall.body.results?.[0]) {
  console.log('Entry recovered:', recall.body.results[0].entry_id);
  console.log('Payload:', JSON.stringify(recall.body.results[0].payload));
  console.log('Chain hash:', recall.body.results[0].chain_hash);
  console.log('Writer identity:', recall.body.results[0].writer_identity_id);
  console.log('Permission verified:', recall.body.results[0].permission_verified);
}
console.log('Thread ID:', threadId);
