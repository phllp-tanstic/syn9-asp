import { config } from '../../config/index.js';

/**
 * Builds an x402 v2 payment-required challenge, per the blueprint's
 * pricing table. Amounts are in the asset's smallest unit (matching
 * OKX's own examples), not decimal — "10000" for a $0.01-equivalent
 * stablecoin amount depends on the asset's decimals, verify against
 * OKX's supported-tokens list before treating these as final.
 *
 * KNOWN GAP: exact decimal precision for USDT on XLayer not yet
 * independently confirmed beyond OKX's own example value — flagged,
 * not silently assumed correct at scale.
 */
const XLAYER_NETWORK = 'eip155:196';
// Corrected per OKX reviewer feedback on ASP #4765 (July 15): every
// real marketplace ASP (CertiK, ChainPulse, FundingArb, etc.) uses
// this USDT contract as their fee token — the onchainOS docs' USDT
// example was not representative of actual ecosystem convention.
const USDT_ASSET = '0x779ded0c9e1022225f8e0630b35a9b54be713736';

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
        asset: USDT_ASSET,
        payTo: config.payment.payToWallet,
        maxTimeoutSeconds: 60,
        extra: { name: 'USDT', version: '2' },
      },
    ],
  };
}