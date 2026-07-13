-- Permission grants: append-only record of mid-workflow allowlist
-- additions. Deliberately NOT implemented as a direct UPDATE to
-- claims.allowed_wallets — that would make grants untraceable (no
-- record of who granted access to whom, when). A grant is itself an
-- auditable event, same as a conflict.
--
-- Read-time permission checking (PermissionModePolicy) must union a
-- claim's original allowed_wallets with any grants recorded here.

CREATE TABLE permission_grants (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id          TEXT UNIQUE NOT NULL,
  claim_id          TEXT NOT NULL REFERENCES claims(claim_id),
  granted_to_wallet TEXT NOT NULL,
  granted_by_identity_id UUID NOT NULL REFERENCES identities(identity_id),
  granted_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON permission_grants (claim_id);