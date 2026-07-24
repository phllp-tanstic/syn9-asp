// src/api/routes/provision.js
//
// POST /v1/provision
//
// Self-service buyer onboarding. Takes a wallet address, registers a
// Syn9 identity, and returns credentials + usage instructions in one
// response. No auth required — this is the entry point before a buyer
// has any credentials. No x402 gate — provisioning is free.
//
// Idempotent by design: if the wallet is already registered, returns
// a 409 with a clear message rather than a hard error. The buyer
// should store their API key from the original registration — it
// cannot be recovered, only the wallet owner can re-register with a
// different wallet address.
//
// Rate-limited to 10/hour per IP — tighter than /v1/identities (20/hr)
// because this endpoint is public-facing and unauthenticated.

import { ValidationError } from '../../core/domain/errors.js';

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

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
      const { walletAddress, webhook_url: webhookUrl } = request.body ?? {};

      if (!walletAddress || typeof walletAddress !== 'string') {
        throw new ValidationError('walletAddress is required');
      }

      if (!EVM_ADDRESS_RE.test(walletAddress)) {
        throw new ValidationError(
          'walletAddress must be a valid EVM address (0x + 40 hex chars)'
        );
      }

      if (webhookUrl !== undefined && typeof webhookUrl !== 'string') {
        throw new ValidationError('webhook_url must be a string if provided');
      }

      let identity, apiKey;
      try {
        ({ identity, apiKey } = await identityProvider.register({
          walletAddress,
          roles: ['agent'],
          webhookUrl: webhookUrl ?? null,
        }));
      } catch (err) {
        // Already registered — return 409 with clear instructions rather
        // than a 400 that looks like a client mistake. The buyer needs to
        // know their key was issued at registration and cannot be re-issued.
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
        // Credentials — store apiKey now, it cannot be retrieved again
        identityId: identity.identityId,
        walletAddress: identity.walletAddress,
        apiKey, // shown exactly once

        // Ready-to-use endpoint
        endpoint: 'https://syn9-asp-production.up.railway.app',

        // Complete usage instructions inline — buyer has everything
        // they need in this single response, no docs lookup required
        usage: {
          authentication: {
            description: 'All authenticated endpoints require two headers',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'X-Agent-Wallet': walletAddress,
            },
          },
          quickstart: {
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
              body: {
                tier: 'standard',
              },
              returns: 'structured opportunity assessment with full provenance chain and contradiction detection',
            },
          },
          payment_note: 'WEAVE and RECALL are payment-gated via x402. Use onchainos payment pay --payload <challenge> --chain xlayer to sign payment challenges from your OKX Agentic Wallet.',
          docs: 'https://syn9-asp-production.up.railway.app/v1/health for liveness. POST /v1/health returns service status.',
        },
      };
    }
  );
}