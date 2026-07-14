## x402 payment integration — RESOLVED, July 14

Previously blocked on OK-ACCESS-PASSPHRASE mismatch (error 50105).
Root cause: unclear, resolved by deleting and recreating the OKX
Payment API key with careful passphrase entry.

Separately found and fixed a real bug in our own client during this
investigation: OkxPaymentClient compared response `code` (a number)
against the string `'0'`, causing every successful API response to be
misidentified as an error.

**Fully verified working, end-to-end, real settlement (not simulated):**
- 402 challenge issuance (WEAVE: $0.002, RECALL raw: $0.00005,
  RECALL synthesized: $0.001, per blueprint pricing table)
- Buyer-side payment authorization via onchainos payment pay (real
  TEE signing)
- Server-side verify + settle via OKX Payment API (real HMAC-signed
  requests, real 200 responses)
- Full WEAVE call succeeding end-to-end with real payment attached
  (confirmed: entry_id syn9_claim_NaNAo-W0dmJEc1zRXeK6LA)