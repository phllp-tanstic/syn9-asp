import { createHmac } from 'node:crypto';
import { config } from '../../config/index.js';

/**
 * WebhookDelivery — HMAC-signed, retrying delivery for conflict/anomaly
 * notifications.
 *
 * Not a port — this is infrastructure plumbing (HTTP delivery with
 * retry semantics), not a swappable business-logic concern the way
 * ClaimStore or AuthorizationPolicy are. A future v2 might swap this
 * for a real queue (SQS, etc.) but that's an implementation detail of
 * "deliver this notification reliably," not a different strategy for
 * deciding what to deliver.
 *
 * Every payload is signed with HMAC-SHA256 over the raw JSON body,
 * carried in the X-Syn9-Signature header, so a receiver can verify the
 * notification genuinely came from Syn9 and wasn't tampered with or
 * spoofed. Receivers verify by recomputing
 * HMAC-SHA256(sharedSecret, rawBody) and comparing.
 *
 * Retries only on network failure or 5xx — a 4xx means the receiver
 * actively rejected the request (bad URL, receiver-side validation
 * failure), and retrying won't fix that.
 *
 * This function is intentionally called fire-and-forget by its callers
 * (never awaited in the request path) — per blueprint constraint #3,
 * anomaly/conflict handling must never block a write or a read. The
 * returned promise exists for testability, not for production call
 * sites to depend on.
 */
export async function deliverWebhook({
  url,
  event,
  signingSecret = config.webhooks.signingSecret,
  maxRetries = config.webhooks.maxRetries,
  retryBaseDelayMs = config.webhooks.retryBaseDelayMs,
}) {
  if (!url) return; // no webhook registered for this identity — not an error

  const body = JSON.stringify(event);
  const signature = signingSecret
    ? createHmac('sha256', signingSecret).update(body).digest('hex')
    : null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(signature && { 'X-Syn9-Signature': signature }),
        },
        body,
      });

      if (response.ok) return; // 2xx — delivered
      if (response.status < 500) {
        // 4xx — receiver rejected it; retrying won't help.
        console.error(
          `Webhook delivery to ${url} rejected with ${response.status}, not retrying.`
        );
        return;
      }
      // 5xx — fall through to retry.
    } catch (err) {
      // Network error — fall through to retry.
      if (attempt === maxRetries) {
        console.error(
          `Webhook delivery to ${url} failed after ${maxRetries + 1} attempts: ${err.message}`
        );
        return;
      }
    }

    if (attempt < maxRetries) {
      const delay = retryBaseDelayMs * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  console.error(`Webhook delivery to ${url} failed after ${maxRetries + 1} attempts (5xx).`);
}