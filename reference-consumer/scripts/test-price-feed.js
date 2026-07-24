// test-price-feed.js
// Standalone verification — run with: node --env-file=.env test-price-feed.js
// Tests each source independently first, then the combined divergence check.
// Requires OKX_PAYMENT_API_KEY / SECRET_KEY / PASSPHRASE / PROJECT_ID in .env
// for the DEX call (CEX call needs no credentials).

import { getCexPrice, getDexPrice, getPricesAndCheckDivergence } from '../lib/price-feed-client.js';

async function main() {
  console.log('--- Source A: CEX spot ---');
  const cex = await getCexPrice();
  console.log(`CEX price: $${cex.price}`);

  console.log('\n--- Source B: DEX aggregator ---');
  const dex = await getDexPrice();
  console.log(`DEX price: $${dex.price}`);

  console.log('\n--- Combined divergence check ---');
  const result = await getPricesAndCheckDivergence();
  console.log(`CEX: $${result.cex.price} | DEX: $${result.dex.price}`);
  console.log(`Divergence: ${result.divergencePct.toFixed(4)}%`);
  console.log(`Fires contradiction detector: ${result.diverges}`);
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});