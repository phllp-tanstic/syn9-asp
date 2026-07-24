// onchain-feed-agent.js
// OnchainFeed — Source A of the two-source price comparison.
// Pulls the OKB spot price from the OKX CEX orderbook (real, public endpoint,
// no auth required) and WEAVEs it to Syn9 with explicit permission for
// SignalAnalyst only.
//
// This is one of two independent price-discovery mechanisms. The other
// (DEX aggregator quote) runs in signal-analyst-agent.js. Divergence between
// them is what triggers the contradiction detector.

import { getCexPrice } from '../lib/price-feed-client.js';

export async function runOnchainFeedAgent({ agent, threadId, signalAnalystWalletAddress }) {
  const { price, source, raw } = await getCexPrice();

  const payload = {
    asset: 'OKB',
    priceUsd: price,
    source,
    mechanism: 'cex_orderbook',
    instId: raw.instId,
    timestamp: Date.now(),
    note: `OKB spot price from OKX CEX orderbook (instId=${raw.instId}): $${price} USDT. ` +
          `Price-discovery mechanism: centralised exchange order matching.`,
  };

  const { status, body } = await agent.weave(threadId, {
    payload,
    permissions: { mode: 'explicit', allow: [signalAnalystWalletAddress] },
    scope: 'workflow',
  });

  if (status !== 201) {
    throw new Error(`OnchainFeed WEAVE failed: ${JSON.stringify(body)}`);
  }

  return {
    entryId: body.entry_id,
    chainHash: body.chain_hash,
    price,
    source,
  };
}