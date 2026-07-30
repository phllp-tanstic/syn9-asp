import { Syn9Agent } from './reference-consumer/lib/syn9-client.js';
import { randomUUID } from 'node:crypto';

const WALLET = '0xdd' + 'd'.repeat(38);
const agent = await Syn9Agent.register('DebugW', WALLET);

console.log('Registered wallet:', agent.walletAddress);
console.log('Wallet in permissions will be:', agent.walletAddress);

const threadId = randomUUID();

const weave = await agent.weave(threadId, {
  payload: { note: 'test' },
  permissions: { mode: 'explicit', allow: [agent.walletAddress] },
  scope: 'workflow',
});
console.log('WEAVE status:', weave.status);
console.log('WEAVE entry_id:', weave.body.entry_id);

// Wait for embedding
await new Promise(r => setTimeout(r, 2000));

const recall = await agent.recall(threadId, {
  intent: 'test note',
  minSimilarity: 0.1,
  topK: 1,
});
console.log('RECALL status:', recall.status);
console.log('RECALL body:', JSON.stringify(recall.body, null, 2));
