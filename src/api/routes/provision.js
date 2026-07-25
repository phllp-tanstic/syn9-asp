// src/api/routes/provision.js
//
// POST /v1/provision
//
// Self-service buyer onboarding with wallet ownership verification.
// Requires proof of wallet control via EIP-191 personal_sign signature
// over a nonce issued by POST /v1/auth/challenge.
//
// Security fix (P0): previously accepted any wallet address string
// with no proof of ownership. Now verifies the caller controls the
// private key for the claimed address before creating an identity.
//
// ONBOARDING FLOW:
//   1. POST /v1/auth/challenge { walletAddress } → { message }
//   2. Sign `message` with wallet private key (EIP-191 personal_sign)
//   3. POST /v1/provision { walletAddress, signature } → credentials + usage
//
// No auth required — this is the entry point before credentials exist.
// No x402 gate — provisioning is free.
// Rate-limited to 10/hr per IP.

import { ethers } from 'ethers';
import { ValidationError } from '../../core/domain/errors.js';
import { consumeChallenge } from '../../modules/identity/challenge-store.js';

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function buildChallengeMessage(walletAddress, nonce) {
  return (
    `Syn9 identity verification\n` +
    `Wallet: ${walletAddress}\n` +
    `Nonce: ${nonce}\n` +
    `This signature proves you control this wallet. It does not authorize any transaction.`
  );
}

export default async function provisionRoutes(fastify, opts) {
  const { identityProvider } = opts;

  fastify.post(
    '/v1/provision',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 hour',
        },
      },
    },
    async (request, reply) => {
      const { walletAddress, signature, webhook_url: webhookUrl } = request.body ?? {};

      if (!walletAddress || typeof walletAddress !== 'string') {
        throw new ValidationError('walletAddress is required');
      }

      if (!EVM_ADDRESS_RE.test(walletAddress)) {
        throw new ValidationError(
          'walletAddress must be a valid EVM address (0x + 40 hex chars)'
        );
      }

      if (!signature || typeof signature !== 'string') {
        throw new ValidationError(
          'signature is required. Call POST /v1/auth/challenge first to obtain a nonce, ' +
          'sign the returned message with your wallet, then submit the signature here.'
        );
      }

      if (webhookUrl !== undefined && typeof webhookUrl !== 'string') {
        throw new ValidationError('webhook_url must be a string if provided');
      }

      // Consume nonce — single-use
      const nonce = consumeChallenge(walletAddress);
      if (!nonce) {
        throw new ValidationError(
          'No valid challenge found for this wallet address. ' +
          'Challenges expire after 5 minutes and are single-use. ' +
          'Call POST /v1/auth/challenge to obtain a new one.'
        );
      }

      // Verify signature
      const message = buildChallengeMessage(walletAddress, nonce);
      let recoveredAddress;
      try {
        recoveredAddress = ethers.verifyMessage(message, signature);
      } catch {
        throw new ValidationError(
          'Invalid signature — could not recover signer address.'
        );
      }

      if (recoveredAddress.toLowerCase() !== walletAddress.toLowerCase()) {
        throw new ValidationError(
          `Signature verification failed: recovered signer (${recoveredAddress}) ` +
          `does not match claimed wallet (${walletAddress}).`
        );
      }

      let identity, apiKey;
      try {
        ({ identity, apiKey } = await identityProvider.register({
          walletAddress,
          roles: ['agent'],
          webhookUrl: webhookUrl ?? null,
        }));
      } catch (err) {
        if (err.code === 'VALIDATION_ERROR' && err.message.includes('already registered')) {
          reply.code(409);
          return {
            error: 'ALREADY_PROVISIONED',
            message: `Wallet ${walletAddress} is already registered with Syn9. Your API key was returned at registration and cannot be recovered. If you have lost it, contact support or register with a different wallet address.`,
            walletAddress,
          };
        }
        throw err;
      }

      reply.code(201);
      return {
        identityId: identity.identityId,
        walletAddress: identity.walletAddress,
        apiKey, // shown exactly once

        endpoint: 'https://syn9-asp-production.up.railway.app',

        usage: {
          authentication: {
            description: 'All authenticated endpoints require two headers',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'X-Agent-Wallet': walletAddress,
            },
          },
          quickstart: {
            step0_challenge: {
              description: 'For future registrations: obtain a challenge first',
              method: 'POST',
              url: 'https://syn9-asp-production.up.railway.app/v1/auth/challenge',
              body: { walletAddress: '<your_wallet>' },
              returns: 'message to sign with your wallet private key',
            },
            step1_weave: {
              description: 'Write a finding with cryptographic provenance',
              method: 'POST',
              url: 'https://syn9-asp-production.up.railway.app/v1/threads/{threadId}/weave',
              note: 'threadId is any UUID you generate — it groups related findings',
              body: {
                payload: { your: 'data here' },
                permissions: { mode: 'explicit', allow: [walletAddress] },
                scope: 'workflow',
              },
              returns: 'entry_id and chain_hash — store these for provenance verification',
            },
            step2_recall: {
              description: 'Retrieve findings by semantic intent',
              method: 'POST',
              url: 'https://syn9-asp-production.up.railway.app/v1/threads/{threadId}/recall',
              body: {
                intent: 'describe what you are looking for in plain language',
                top_k: 3,
                min_similarity: 0.2,
              },
              returns: 'matching entries with similarity scores, writer identity, and chain hashes',
            },
            step3_research_cycle: {
              description: 'Run a fully managed multi-source research pipeline in one call',
              method: 'POST',
              url: 'https://syn9-asp-production.up.railway.app/v1/research-cycles',
              note: 'Requires payment via x402 — 0.50 USDT standard tier, 1.00 USDT deep tier',
              body: { tier: 'standard' },
              returns: 'structured opportunity assessment with full provenance chain and contradiction detection',
            },
          },
          payment_note: 'WEAVE and RECALL are payment-gated via x402. Use onchainos payment pay --payload <challenge> --chain xlayer to sign payment challenges from your OKX Agentic Wallet.',
          docs: 'https://syn9-asp-production.up.railway.app/v1/health for liveness.',
        },
      };
    }
  );
}