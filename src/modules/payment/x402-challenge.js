import { config } from '../../config/index.js';

/**
 * Builds an x402 v2 payment-required challenge, per the blueprint's
 * pricing table. Amounts are in the asset's smallest unit (matching
 * OKX's own examples), not decimal — "10000" for a $0.01-equivalent
 * stablecoin amount depends on the asset's decimals, verify against
 * OKX's supported-tokens list before treating these as final.
 *
 * KNOWN GAP: exact decimal precision for USDG on XLayer not yet
 * independently confirmed beyond OKX's own example value — flagged,
 * not silently assumed correct at scale.
 */
const XLAYER_NETWORK = 'eip155:196';
const USDG_ASSET = '0x4ae46a509f6b1d9056937ba4500cb143933d2dc8';

export function buildChallenge({ amount, resourceUrl, description }) {
  return {
    x402Version: 2,
    resource: {
      url: resourceUrl,
      description,
      mimeType: 'application/json',
    },
    accepts: [
      {
        scheme: 'exact',
        network: XLAYER_NETWORK,
        amount: String(amount),
        asset: USDG_ASSET,
        payTo: config.payment.payToWallet,
        maxTimeoutSeconds: 60,
        extra: { name: 'USDG', version: '2' },
      },
    ],
  };
}