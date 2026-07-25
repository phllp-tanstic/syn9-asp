// src/api/routes/auth.js
//
// POST /v1/auth/challenge
//
// Issues a nonce that the caller must sign with their wallet's private
// key to prove ownership before registering an identity. The signed
// nonce is submitted alongside the wallet address in POST /v1/identities
// or POST /v1/provision.
//
// Flow:
//   1. POST /v1/auth/challenge { walletAddress }
//      → { challenge, message, expiresIn }
//   2. Sign `message` using EIP-191 personal_sign with the wallet's key
//   3. POST /v1/identities or /v1/provision { walletAddress, signature }
//      → server recovers signer, verifies match, creates identity
//
// No auth required — this is the pre-registration step.
// Rate-limited to 20/hr per IP — prevents nonce harvesting attacks.

import { ValidationError } from '../../core/domain/errors.js';
import { issueChallenge } from '../../modules/identity/challenge-store.js';

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const CHALLENGE_TTL_SECONDS = 300; // 5 minutes, matches challenge-store.js

export default async function authRoutes(fastify, opts) {
  fastify.post(
    '/v1/auth/challenge',
    {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: '1 hour',
        },
      },
    },
    async (request, reply) => {
      const { walletAddress } = request.body ?? {};

      if (!walletAddress || typeof walletAddress !== 'string') {
        throw new ValidationError('walletAddress is required');
      }

      if (!EVM_ADDRESS_RE.test(walletAddress)) {
        throw new ValidationError(
          'walletAddress must be a valid EVM address (0x + 40 hex chars)'
        );
      }

      const nonce = issueChallenge(walletAddress);

      // The message the caller must sign verbatim with personal_sign.
      // Including the wallet address and service name prevents
      // cross-service signature replay.
      const message =
        `Syn9 identity verification\n` +
        `Wallet: ${walletAddress}\n` +
        `Nonce: ${nonce}\n` +
        `This signature proves you control this wallet. It does not authorize any transaction.`;

      reply.code(201);
      return {
        challenge: nonce,
        message,
        walletAddress,
        expiresIn: CHALLENGE_TTL_SECONDS,
        instructions: 'Sign the `message` field using EIP-191 personal_sign (eth_sign or personal_sign in MetaMask/ethers.js). Submit the result as `signature` alongside `walletAddress` to POST /v1/identities or POST /v1/provision.',
      };
    }
  );
}