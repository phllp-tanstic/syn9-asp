import { Syn9Agent } from './reference-consumer/lib/syn9-client.js';

const agent = await Syn9Agent.register('DebugAgent', '0xcc' + 'c'.repeat(38));
const recall = await agent.recall('514c70ec-eb41-40b7-9f4c-5f3e62b6b4de', {
  intent: 'OKB price',
  minSimilarity: 0.1,
  topK: 1,
});
console.log('Status:', recall.status);
console.log('Body:', JSON.stringify(recall.body, null, 2));
