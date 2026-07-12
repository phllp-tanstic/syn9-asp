-- Add optional webhook URL to identities, for anomaly/conflict
-- delivery. Nullable — webhooks are opt-in, not every agent wants
-- push delivery; the polling endpoint (GET /v1/threads/:threadId/
-- conflicts) is the durable source of truth regardless of whether a
-- webhook is registered, since webhook delivery can silently fail.

ALTER TABLE identities ADD COLUMN webhook_url TEXT;