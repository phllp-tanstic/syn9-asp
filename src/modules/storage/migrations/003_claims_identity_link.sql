-- Link claims to the identities table, and remove raw API key storage
-- from claims entirely.
--
-- migration 001 (copied from the blueprint's original schema) stored
-- claims.writer_api_key as a raw string on every claim — redundant with,
-- and less safe than, the properly-hashed api_keys table added in
-- migration 002. No claim should ever hold a raw key. writer_wallet is
-- kept (denormalized, cheap for wallet-scoped queries) but is now
-- backed by a real foreign key via writer_identity_id rather than being
-- the only writer reference.

ALTER TABLE claims
  ADD COLUMN writer_identity_id UUID REFERENCES identities(identity_id);

ALTER TABLE claims
  DROP COLUMN writer_api_key;

CREATE INDEX ON claims (writer_identity_id);