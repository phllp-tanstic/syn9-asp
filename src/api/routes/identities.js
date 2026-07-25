// src/api/routes/identities.js
//
// POST /v1/identities
//
// Registers a new Syn9 identity. Signature verification is optional
// but recommended — if a signature is provided, it is verified against
// the claimed wallet address via EIP-191 personal_sign recovery.
//
// Security posture by caller type:
//   - Public buyers: should use POST /v1/provision (signature required)
//   - Internal pipeline agents: use this endpoint with throwaway wallet
//     addresses that are never used as explicit-mode grant targets
//   - Anyone providing a signature: verified before registration
//
// The real attack surface (identity squatting of a real buyer's wallet
// before they register) is addressed at POST /v1/provision, which
// requires signature proof. This endpoint remains useful for internal
// multi-agent pipelines that register ephemeral identities with
// generated wallet strings.
//
// Rate-limited to 20 registrations per hour per caller.
// API key returned exactly once — cannot be recovered.

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

export default async function identitiesRoutes(fastify, opts) {
  const { identityProvider } = opts;

  fastify.post(
    '/v1/identities',
    {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: '1 hour',
        },
      },
    },
    async (request, reply) => {
      const {
        walletAddress,
        signature,
        roles,
        webhook_url: webhookUrl,
      } = request.body ?? {};

      if (!walletAddress || typeof walletAddress !== 'string') {
        throw new ValidationError('walletAddress is required', {
          details: { field: 'walletAddress' },
        });
      }

      if (webhookUrl !== undefined && typeof webhookUrl !== 'string') {
        throw new ValidationError('webhook_url must be a string if provided');
      }

      // If a signature is provided, verify it — regardless of whether
      // the wallet address passes EVM format validation. This prevents
      // a caller from submitting a valid signature for an invalid address.
      if (signature) {
        if (!EVM_ADDRESS_RE.test(walletAddress)) {
          throw new ValidationError(
            'walletAddress must be a valid EVM address (0x + 40 hex chars) when signature is provided'
          );
        }

        const nonce = consumeChallenge(walletAddress);
        if (!nonce) {
          throw new ValidationError(
            'No valid challenge found for this wallet address. ' +
            'Challenges expire after 5 minutes and are single-use. ' +
            'Call POST /v1/auth/challenge to obtain a new one.'
          );
        }

        const message = buildChallengeMessage(walletAddress, nonce);
        let recoveredAddress;
        try {
          recoveredAddress = ethers.verifyMessage(message, signature);
        } catch {
          throw new ValidationError(
            'Invalid signature — could not recover signer address. ' +
            'Ensure you signed the exact message returned by POST /v1/auth/challenge.'
          );
        }

        if (recoveredAddress.toLowerCase() !== walletAddress.toLowerCase()) {
          throw new ValidationError(
            `Signature verification failed: recovered signer (${recoveredAddress}) ` +
            `does not match claimed wallet (${walletAddress}).`
          );
        }
      }

      const { identity, apiKey } = await identityProvider.register({
        walletAddress,
        roles,
        webhookUrl: webhookUrl ?? null,
      });

      reply.code(201);
      return {
        identityId: identity.identityId,
        walletAddress: identity.walletAddress,
        roles: identity.roles,
        webhook_url: identity.webhookUrl,
        apiKey, // shown exactly once — store this now, it cannot be retrieved again
        ownership_verified: !!signature,
      };
    }
  );
}