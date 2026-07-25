// src/modules/identity/challenge-store.js
//
// In-memory nonce store for wallet ownership challenges.
// Challenges expire after 5 minutes — short enough to prevent replay,
// long enough for a human or agent to complete the sign-in flow.
// Lost on server restart — callers simply request a new challenge.
// Single-use: a nonce is deleted immediately on first use regardless
// of whether verification succeeds, preventing replay attacks.

const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const store = new Map(); // walletAddress (lowercase) -> { nonce, expiresAt }

/**
 * Issues a challenge for a wallet address.
 * Overwrites any existing challenge for the same wallet.
 * @param {string} walletAddress
 * @returns {string} nonce
 */
export function issueChallenge(walletAddress) {
  const nonce = crypto.randomUUID();
  store.set(walletAddress.toLowerCase(), {
    nonce,
    expiresAt: Date.now() + CHALLENGE_TTL_MS,
  });
  return nonce;
}

/**
 * Consumes a challenge for a wallet address.
 * Returns the nonce if valid and not expired, null otherwise.
 * Always deletes the challenge after retrieval (single-use).
 * @param {string} walletAddress
 * @returns {string|null} nonce or null
 */
export function consumeChallenge(walletAddress) {
  const key = walletAddress.toLowerCase();
  const entry = store.get(key);
  store.delete(key); // single-use — delete regardless of validity
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) return null;
  return entry.nonce;
}

// Periodic cleanup of expired entries — prevents unbounded memory growth
// under high challenge-request volume without corresponding completions.
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now > entry.expiresAt) store.delete(key);
  }
}, CHALLENGE_TTL_MS);