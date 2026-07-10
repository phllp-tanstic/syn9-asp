import { randomBytes } from 'node:crypto';

/**
 * Generates a prefixed, URL-safe random ID — e.g. syn9_claim_a1b2c3...
 *
 * Not cryptographically sequential or sortable (no timestamp component)
 * — created_at columns handle ordering. Kept dependency-free rather
 * than pulling in nanoid, consistent with minimizing dependencies
 * established Day 1.
 */
export function generateId(prefix) {
  const random = randomBytes(16).toString('base64url');
  return `${prefix}_${random}`;
}