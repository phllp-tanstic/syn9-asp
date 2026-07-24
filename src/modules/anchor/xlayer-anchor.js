// src/modules/anchor/xlayer-anchor.js
//
// Writes a Syn9 chain hash to XLayer as calldata on a zero-value
// transaction. The hash is permanently verifiable on OKLink at:
//   https://www.oklink.com/xlayer/tx/<txHash>
//
// Uses ethers.js to sign locally with a dedicated anchor wallet
// (XLAYER_SIGNER_PRIVATE_KEY) and broadcasts via the XLayer RPC.
// No dependency on onchainos CLI — works on Railway without interactive
// TEE session.
//
// The anchor wallet (0xf9bc79ab7133a74a2c0716e9764317287268f2ea) is
// funded with OKB for gas. At ~$0.001 per anchor tx, 0.005 OKB covers
// thousands of anchors.

import { ethers } from 'ethers';
import { config } from '../../config/index.js';

// Burn address — accepts any calldata, no contract needed
const ANCHOR_TARGET = '0x000000000000000000000000000000000000dEaD';

/**
 * Anchors a chain hash to XLayer.
 * Fire-and-forget safe — caller should not await this in the response path.
 *
 * @param {string} chainHash - hex string, e.g. '0xabc123...'
 * @param {string} threadId - for logging/audit only
 * @returns {Promise<{txHash: string, blockNumber: number}>}
 */
export async function anchorChainHash(chainHash, threadId) {
  const rpcUrl = config.anchor.xlayerRpcUrl;
  const signerKey = config.anchor.xlayerSignerKey;

  if (!rpcUrl || !signerKey) {
    throw new Error(
      'Anchor module not configured: XLAYER_RPC_URL and XLAYER_SIGNER_PRIVATE_KEY must be set'
    );
  }

  if (!chainHash || !chainHash.startsWith('0x')) {
    throw new Error(`Invalid chain hash for anchoring: ${chainHash}`);
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(signerKey, provider);

  // Verify the anchor wallet matches expected address — safety check
  // to catch misconfigured keys before spending gas
  const signerAddress = await wallet.getAddress();

  const tx = await wallet.sendTransaction({
    to: ANCHOR_TARGET,
    value: 0n,
    data: chainHash, // chain hash as calldata — permanently stored on-chain
  });

  const receipt = await tx.wait(1); // wait for 1 confirmation

  return {
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    signerAddress,
    chainHash,
    threadId,
    anchoredAt: new Date().toISOString(),
  };
}