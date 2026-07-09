-- Identities and API keys.
--
-- Gap in the original blueprint schema: claims.writer_api_key stored a
-- key string on every claim, but nothing validated that key was real or
-- resolved it to a stable identity. This migration adds that source of
-- truth — required for modules/identity's ApiKeyWalletProvider (the
-- concrete implementation of core/ports/identity-provider.js) to have
-- anything to check against.

-- Identities: the stable, long-lived record an agent is known by.
-- Maps 1:1 to the Identity type in core/ports/identity-provider.js.
-- A wallet address is the natural external anchor (v1 auth per
-- blueprint R2), but identity_id is what the rest of the system
-- references — never the raw wallet string — so v2's wallet-native
-- signing can swap the authentication mechanism without touching
-- every foreign key in the schema.
CREATE TABLE identities (
  identity_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address  TEXT UNIQUE NOT NULL,
  roles           TEXT[] NOT NULL DEFAULT ARRAY['agent'],
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON identities (wallet_address);

-- API keys: hashed, never plaintext. Revocable independently of the
-- identity itself — an identity can rotate keys without losing its
-- claim history or accumulated reputation.
CREATE TABLE api_keys (
  api_key_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_id     UUID NOT NULL REFERENCES identities(identity_id),
  key_hash        TEXT UNIQUE NOT NULL,   -- SHA256(raw key + SYN9_API_KEY_SALT)
  revoked         BOOLEAN DEFAULT FALSE,
  revoked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON api_keys (key_hash) WHERE revoked = FALSE;
CREATE INDEX ON api_keys (identity_id);

-- claims.writer_wallet / writer_api_key predate this migration and stay
-- as-is for now (denormalized, matches blueprint's original design) —
-- application code resolves writer_wallet -> identities.wallet_address
-- at write time via IdentityProvider, rather than this migration
-- retrofitting a foreign key onto an already-applied table.