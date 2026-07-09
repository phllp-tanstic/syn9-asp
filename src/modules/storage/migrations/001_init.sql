-- Syn9 storage schema.
--
-- Naming note: the build blueprint's reference schema used
-- "context_entries" / "entry_id". Renamed here to "claims" / "claim_id"
-- to match the domain model (src/core/domain/claim.js) — Syn9 stores
-- verifiable collaborative state, not chat history or generic memory
-- entries. Column types, constraints, and indexes are unchanged from
-- the blueprint's specification.

CREATE EXTENSION IF NOT EXISTS vector;

-- Claims: the fundamental unit of shared state. Append-only — no UPDATE
-- path exists in application code. The only mutation is revoke().
CREATE TABLE claims (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id         UUID NOT NULL,
  claim_id          TEXT UNIQUE NOT NULL,          -- syn9_claim_{nanoid}
  writer_wallet     TEXT NOT NULL,
  writer_api_key    TEXT NOT NULL,
  payload           TEXT NOT NULL,                 -- encrypted at rest (AES-256)
  payload_hash      TEXT NOT NULL,                 -- SHA256 of plaintext payload
  embedding         VECTOR(1536),
  permission_mode   TEXT NOT NULL,                 -- 'explicit' | 'task_chain' | 'open'
  allowed_wallets   TEXT[],                        -- for explicit mode
  task_id           TEXT,                          -- for task_chain mode
  scope             TEXT NOT NULL,                 -- 'workflow' | 'session' | 'persistent'
  chain_hash        TEXT NOT NULL,                 -- chained provenance hash
  prev_hash         TEXT,                          -- hash of previous claim in thread
  revoked           BOOLEAN DEFAULT FALSE,
  revoked_at        TIMESTAMPTZ,
  expires_at        TIMESTAMPTZ,                   -- null for persistent scope
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON claims USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX ON claims (thread_id, revoked, expires_at);
CREATE INDEX ON claims (writer_wallet);

-- Conflicts: co-existing contradictory claims. Never resolved by
-- overwrite — both claims remain independently readable/permissioned.
-- (Not in the blueprint's original schema — added to match
-- src/core/domain/conflict.js, since the blueprint's anomaly_flag
-- was a JSONB column on the entry itself; a separate table lets a
-- claim be referenced by multiple conflicts and supports the future
-- consensus/resolution workflow without reshaping the claims table.)
CREATE TABLE conflicts (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conflict_id             TEXT UNIQUE NOT NULL,     -- syn9_conflict_{nanoid}
  thread_id               UUID NOT NULL,
  claim_id                TEXT NOT NULL REFERENCES claims(claim_id),
  conflicts_with_claim_id TEXT NOT NULL REFERENCES claims(claim_id),
  similarity_score        REAL NOT NULL,
  summary                 TEXT NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'open', -- 'open' | 'acknowledged' | 'resolved'
  detected_at             TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON conflicts (thread_id, status);
CREATE INDEX ON conflicts (claim_id);

-- Audit events: append-only trust trail over access to claims. Separate
-- from claims by design — claims are the data, audit events are the
-- record of who touched that data and when. Every event here is a
-- candidate for the next XLayer anchor batch.
CREATE TABLE audit_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          TEXT UNIQUE NOT NULL,          -- evt_{nanoid}
  type              TEXT NOT NULL,                 -- 'weave' | 'recall' | 'revoke' | 'permission_grant' | 'permission_denied'
  thread_id         UUID NOT NULL,
  actor_identity_id TEXT NOT NULL,
  detail            JSONB NOT NULL DEFAULT '{}',
  chain_hash        TEXT NOT NULL,                 -- chained receipt hash
  prev_event_hash   TEXT,
  anchored          BOOLEAN DEFAULT FALSE,
  anchor_batch_id   TEXT,
  occurred_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON audit_events (thread_id, occurred_at);
CREATE INDEX ON audit_events (anchored, occurred_at);
CREATE INDEX ON audit_events (actor_identity_id);

-- Anchor batches: merkle-rooted commitments of audit events, submitted
-- to XLayer (or Sepolia as fallback) roughly every 10 minutes.
CREATE TABLE anchor_batches (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id        TEXT UNIQUE NOT NULL,
  merkle_root     TEXT NOT NULL,
  event_ids       TEXT[] NOT NULL,
  chain           TEXT NOT NULL,                   -- 'xlayer' | 'sepolia'
  tx_hash         TEXT,
  anchored_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);