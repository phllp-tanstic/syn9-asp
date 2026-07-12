import { randomBytes, createHash } from 'node:crypto';
import { IdentityProvider } from '../../core/ports/identity-provider.js';
import { AuthenticationError, ValidationError } from '../../core/domain/errors.js';
import { config } from '../../config/index.js';

/**
 * ApiKeyWalletProvider — v1 concrete IdentityProvider.
 *
 * Trusts an API key + X-Agent-Wallet header pair (blueprint R2:
 * wallet-native signature verification is TEE-internal only, not
 * publicly verifiable in v1). Raw API keys are never persisted — only
 * a salted SHA256 hash. The raw key is returned exactly once, at
 * registration, and cannot be recovered afterward — matches the
 * standard practice for API tokens (GitHub, Stripe, etc.).
 *
 * authenticate() deliberately checks two things, not one: that the key
 * hash matches a live row, AND that the wallet address supplied in the
 * request header matches the identity that key belongs to. Checking
 * only the key would let a stolen/leaked key be replayed under an
 * arbitrary wallet header without detection.
 */
export class ApiKeyWalletProvider extends IdentityProvider {
  /** @param {import('pg').Pool} pool */
  constructor(pool) {
    super();
    this.pool = pool;
  }

  _hashKey(rawKey) {
    const salt = config.identity.apiKeySalt ?? '';
    return createHash('sha256').update(rawKey + salt).digest('hex');
  }

  _generateRawKey() {
    return 'syn9_' + randomBytes(32).toString('hex');
  }

  async register({ walletAddress, roles = ['agent'], webhookUrl = null }) {
    const existing = await this.pool.query(
      'SELECT identity_id FROM identities WHERE wallet_address = $1',
      [walletAddress]
    );
    if (existing.rows.length > 0) {
      throw new ValidationError(
        `Wallet ${walletAddress} is already registered`,
        { details: { walletAddress } }
      );
    }

    const identityResult = await this.pool.query(
      `INSERT INTO identities (wallet_address, roles, webhook_url)
       VALUES ($1, $2, $3)
       RETURNING identity_id, wallet_address, roles, webhook_url`,
      [walletAddress, roles, webhookUrl]
    );
    const identityRow = identityResult.rows[0];

    const rawKey = this._generateRawKey();
    const keyHash = this._hashKey(rawKey);

    await this.pool.query(
      `INSERT INTO api_keys (identity_id, key_hash)
       VALUES ($1, $2)`,
      [identityRow.identity_id, keyHash]
    );

    return {
      identity: {
        identityId: identityRow.identity_id,
        walletAddress: identityRow.wallet_address,
        roles: identityRow.roles,
        webhookUrl: identityRow.webhook_url,
      },
      apiKey: rawKey,
    };
  }

  async getById(identityId) {
    const result = await this.pool.query(
      'SELECT identity_id, wallet_address, roles, webhook_url FROM identities WHERE identity_id = $1',
      [identityId]
    );
    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      identityId: row.identity_id,
      walletAddress: row.wallet_address,
      roles: row.roles,
      webhookUrl: row.webhook_url,
    };
  }

  async authenticate({ apiKey, walletAddress }) {
    if (!apiKey || !walletAddress) {
      throw new AuthenticationError(
        'Missing API key or X-Agent-Wallet header'
      );
    }

    const keyHash = this._hashKey(apiKey);

    const result = await this.pool.query(
      `SELECT i.identity_id, i.wallet_address, i.roles, i.webhook_url
       FROM api_keys ak
       JOIN identities i ON i.identity_id = ak.identity_id
       WHERE ak.key_hash = $1 AND ak.revoked = FALSE`,
      [keyHash]
    );

    if (result.rows.length === 0) {
      throw new AuthenticationError('Invalid or revoked API key');
    }

    const identityRow = result.rows[0];

    if (identityRow.wallet_address !== walletAddress) {
      throw new AuthenticationError(
        'X-Agent-Wallet header does not match the identity for this API key'
      );
    }

    return {
      identityId: identityRow.identity_id,
      walletAddress: identityRow.wallet_address,
      roles: identityRow.roles,
      webhookUrl: identityRow.webhook_url,
    };
  }
}