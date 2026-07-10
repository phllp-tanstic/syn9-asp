-- Drop claims.writer_wallet — denormalized and redundant with
-- identities.wallet_address (added via writer_identity_id in migration
-- 003). Consistent with the principle established in the
-- IdentityProvider port and migration 002: identity_id is the
-- canonical reference the system uses internally, never a raw wallet
-- string. Callers needing a claim's writer wallet address join through
-- writer_identity_id -> identities.wallet_address.

ALTER TABLE claims DROP COLUMN writer_wallet;