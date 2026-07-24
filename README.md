# Syn9

**Shared, cryptographically attributed memory for multi-agent pipelines — with per-entry permission control, contradiction detection, and on-chain anchoring.**

![Status](https://img.shields.io/badge/status-live-brightgreen) ![License](https://img.shields.io/badge/license-MIT-blue) ![Node](https://img.shields.io/badge/node-%3E%3D20.0.0-green) ![OKX AI](https://img.shields.io/badge/OKX%20AI-ASP%20%234765-blue) ![Deployed](https://img.shields.io/badge/deployed-Railway-purple)

---

## Overview

Syn9 is a trust layer for multi-agent pipelines. When multiple independent agents contribute findings toward a shared output — a scored opportunity, a risk assessment, a research brief — Syn9 records what each agent wrote, when it wrote it, and who is permitted to read it. It detects when independent sources contradict each other and surfaces that contradiction without blocking the workflow. Every read and write is audited with a verifiable chain of custody.

The core distinction from existing agent memory systems is scope. Tools like Mem0, Zep, and LangMem are designed for a single agent remembering things about itself or its user across sessions. Syn9 is designed for multiple independent agents writing to a shared store where each contribution is cryptographically attributed to a specific identity, permission-gated per entry, and automatically checked for semantic contradiction against prior entries. No existing agent memory tool in the OKX ecosystem or elsewhere addresses this combination.

Syn9 exposes four primitives: **WEAVE** (write with provenance), **RECALL** (permissioned semantic retrieval), **REVOKE** (writer-controlled invalidation), and **PERMISSION_GRANT** (post-hoc access delegation). These primitives compose into pipelines. The reference implementation demonstrates a three-agent DeFi research pipeline: two independent price sources write findings, a contradiction is detected automatically, and a strategy writer synthesizes the permitted results — producing a structured output with a full provenance chain and on-chain anchor.

Syn9 is live as an Agent Service Provider (ASP) on the OKX AI marketplace at [okx.ai/agents/4765](https://www.okx.ai/agents/4765). Payment is handled via x402 micropayments on XLayer (USDT). No SDK is required to use the service.

---

## The Problem

Multi-agent pipelines accumulate a coordination debt that grows with agent count. In the absence of shared, attributed memory infrastructure, teams resort to patterns that fail at scale:

**Context re-injection.** Each agent re-receives the full upstream context via prompt injection. Token costs scale with pipeline depth. Context windows fill with redundant state. There is no mechanism to retrieve only what is relevant.

**Anonymous shared state.** When agents write to a shared database or vector store without attribution, the system loses the ability to answer: who wrote this, when, and under what authority? Downstream agents cannot distinguish findings from different sources, cannot verify that a claim was authored by a trusted identity, and cannot detect when two sources contradict each other.

**Unrestricted retrieval.** Most shared memory systems apply no access control at the entry level. An agent that should not see a specific finding can retrieve it freely. This is not a theoretical concern — in real pipelines, agents operate with different trust levels, different roles, and different need-to-know boundaries.

**No contradiction surface.** When two agents report conflicting facts — different prices for the same asset, different risk assessments for the same wallet, different summaries of the same document — there is no mechanism to detect the conflict, preserve both findings, or flag the divergence to downstream consumers.

**No audit trail.** Post-hoc verification of what data informed a decision is either impossible or dependent on application-level logging that may be incomplete, tampered, or simply absent.

Syn9 addresses all five failure modes as first-class protocol properties, not application-layer conventions.

---

## The Syn9 Model

The fundamental abstraction is the **thread** — a shared, append-only sequence of attributed findings. Any registered identity can write to a thread. Writes are permission-scoped at the time of creation. Reads are evaluated against the permission model of each individual entry. The thread is a coordination surface, not a trust boundary — the trust boundary is the entry.

A **claim** is the unit of state. Every claim carries: a unique ID, the writer's identity ID, a SHA256 hash of the payload, an AES-256-GCM encrypted payload, a 1536-dimensional semantic embedding, a permission specification, a chain hash linking it to the previous claim in the thread, and timestamps. Claims are never deleted — they are revoked (marked invalid, excluded from retrieval) while their chain position is preserved.

The **provenance chain** is a hash-linked sequence. Each claim's chain hash is computed as `SHA256(prevHash | claimId | payloadHash | timestamp | writerIdentityId)`. This means any modification to any claim in the sequence invalidates every subsequent hash — the chain is tamper-evident across the full history of a thread.

The **permission model** operates at write time. A writer specifies one of three modes: `explicit` (allow-list of wallet addresses), `open` (any authenticated identity), or `task_chain` (OKX task membership — currently blocked on a missing platform API, deny-by-default, documented). Post-hoc access can be extended via `PERMISSION_GRANT`, which adds identities to a claim's allow-list without modifying the claim or its chain hash.

**Contradiction detection** runs as a fire-and-forget background task on every WEAVE. The detector embeds the new claim, searches for semantically similar prior claims (cosine similarity ≥ 0.88 against top-3 candidates), and for each candidate passes both claims to a Groq LLM for contradiction evaluation. Detected conflicts are persisted to a `conflicts` table and delivered via webhook to the contradicted claim's writer. The write always succeeds regardless of conflict status — contradiction is advisory metadata, not a gate.

**On-chain anchoring** writes the latest chain hash of a thread to XLayer as calldata on a zero-value transaction after every research cycle. The anchor is permanently verifiable on OKLink. Gas cost is sub-cent.

---

## Core Primitives

### WEAVE — `POST /v1/threads/:threadId/weave`

Writes a claim to a thread with full provenance. The server generates a claim ID, embeds the payload via Gemini `gemini-embedding-001` (1536 dims), computes the chain hash, encrypts the payload (AES-256-GCM, random IV per write), and appends the claim to the thread. Returns the entry ID and chain hash synchronously. Contradiction detection runs asynchronously after the response.

**Authentication:** Bearer token + `X-Agent-Wallet` header.  
**Payment:** x402, $0.002 USDT per call.  
**Scope values:** `session` (24h TTL), `workflow` (7d TTL), `permanent`.

```http
POST /v1/threads/550e8400-e29b-41d4-a716-446655440000/weave
Authorization: Bearer syn9_...
X-Agent-Wallet: 0x...

{
  "payload": { "asset": "OKB", "priceUsd": 82.13, "source": "okx_cex_spot" },
  "permissions": { "mode": "explicit", "allow": ["0xRecipientWallet"] },
  "scope": "workflow"
}
```

```json
{
  "entry_id": "syn9_claim_...",
  "chain_hash": "0x...",
  "timestamp": "2026-07-24T00:00:00.000Z",
  "anomaly_flag": null
}
```

---

### RECALL — `POST /v1/threads/:threadId/recall`

Semantic retrieval over a thread's claims. The server embeds the caller's intent query (RETRIEVAL_QUERY task type), runs a pgvector cosine similarity search, evaluates each candidate against the caller's identity under the permission model, and returns permitted results. Denied matches are silently filtered unless every match above the similarity threshold is denied — in that case, a `PERMISSION_DENIED` error is returned with `entryExists: true`, confirming the entry exists without leaking content. Optional `synthesis: true` passes permitted results to a Groq LLM for natural-language synthesis.

**Authentication:** Bearer token + `X-Agent-Wallet` header.  
**Payment:** x402, $0.00005 USDT (raw) or $0.001 USDT (synthesis).

```http
POST /v1/threads/550e8400-e29b-41d4-a716-446655440000/recall
Authorization: Bearer syn9_...
X-Agent-Wallet: 0x...

{
  "intent": "OKB spot price from CEX orderbook",
  "top_k": 3,
  "min_similarity": 0.2,
  "synthesis": true
}
```

```json
{
  "results": [{
    "entry_id": "syn9_claim_...",
    "payload": { "asset": "OKB", "priceUsd": 82.13 },
    "similarity_score": 0.923,
    "writer_identity_id": "uuid",
    "chain_hash": "0x...",
    "permission_verified": true
  }],
  "synthesized_context": "OKB spot price is $82.13 USDT from the OKX CEX orderbook.",
  "source_entry_ids": ["syn9_claim_..."],
  "read_receipt_id": "rcpt_..."
}
```

---

### REVOKE — `DELETE /v1/threads/:threadId/entries/:entryId`

Marks a claim as revoked. Only the original writer may revoke their own claim. The claim is excluded from all subsequent RECALL operations. The chain hash is preserved — revocation does not break the chain. The `revoked_at` timestamp and the claim's position in the hash chain constitute the revocation audit record.

**Authentication:** Bearer token + `X-Agent-Wallet` header (must match original writer).  
**Payment:** None.

---

### PERMISSION_GRANT — `POST /v1/threads/:threadId/entries/:entryId/grant`

Grants read access to a specific claim for a specific wallet address, post-hoc. The grant is additive — it extends the existing allow-list without replacing it. Only the original writer may grant. The grant is recorded in the `permission_grants` table and is immediately effective for subsequent RECALL evaluations. The original claim's chain hash is not modified.

**Authentication:** Bearer token + `X-Agent-Wallet` header (must match original writer).  
**Payment:** None.

---

## Why This Is Different From Traditional Agent Memory

| Capability | Mem0 / Zep / LangMem | Syn9 |
|---|---|---|
| Primary design target | Single agent, single user | Multiple independent agents, shared pipeline |
| Write attribution | None or application-level | Cryptographic identity binding per entry |
| Per-entry permissions | Not supported | Explicit allow-list, open, or task-scoped |
| Contradiction detection | Not supported | Automatic, LLM-evaluated, non-blocking |
| Hash-linked provenance chain | Not supported | SHA256 chain across full thread history |
| Payload encryption at rest | Varies | AES-256-GCM, random IV per write |
| Audit log | Application-level | Separately chained audit events table |
| Post-hoc access delegation | Not supported | PERMISSION_GRANT, additive, audited |
| On-chain anchoring | Not supported | XLayer, automatic per research cycle |
| x402 payment gating | Not supported | Per-call and per-cycle, real settlement |

The distinction is not feature count — it is design intent. Existing tools are built around a single party's memory of its own interactions. Syn9 is built around multiple parties writing to a shared store where the integrity, attribution, and access control of every individual entry is a protocol-level guarantee, not a convention.

---

## Architecture

Syn9 uses a ports-and-adapters (hexagonal) architecture. The domain core defines interfaces (ports). Concrete implementations (adapters) are injected at the composition root in `server.js`. No route, domain object, or business rule imports a concrete infrastructure module directly. This means the Postgres adapter, the Gemini embedding provider, the Groq synthesis engine, and the OKX payment client are all substitutable without modifying any domain logic — a property that matters for testing, for future chain integrations, and for running Syn9 against different embedding or LLM providers.

```mermaid
graph TD
    Client["External Agent / Browser"] -->|HTTP| API["API Layer\nsrc/api/"]
    API -->|auth| Auth["requireAuth\nmiddleware"]
    API -->|payment| Payment["requirePayment\nx402 middleware"]
    API -->|routes| Routes["WEAVE · RECALL · REVOKE\nPERMISSION_GRANT · Conflicts\nResearch Cycles · Demo · Provision"]
    Routes -->|ports| Core["Core Domain\nsrc/core/"]
    Core -->|ClaimStore| PG["PostgresClaimStore\n+ pgvector"]
    Core -->|EmbeddingProvider| Gemini["GeminiEmbeddingProvider\ngemini-embedding-001 1536d"]
    Core -->|SynthesisEngine| Groq["GroqSynthesisEngine\nllama-3.3-70b-versatile"]
    Core -->|AnomalyDetector| GroqAnomaly["GroqAnomalyDetector\nfire-and-forget"]
    Core -->|ProvenanceChain| SHA256["Sha256Chain\nSHA256 hash linking"]
    Core -->|EncryptionProvider| AES["AesGcmEncryptionProvider\nAES-256-GCM"]
    Core -->|IdentityProvider| Identity["ApiKeyWalletProvider\nBcrypt hashed keys"]
    Core -->|AuditLog| Audit["PostgresAuditLog\nseparately chained"]
    Routes -->|anchor| Anchor["XLayerAnchor\nethers.js · XLayer RPC"]
    Routes -->|payment client| OKX["OkxPaymentClient\nHMAC-signed x402"]
```

### Layer responsibilities

**`src/core/domain/`** — Domain objects (`Claim`, `Conflict`), error types, ID generation, permission validation. No infrastructure imports.

**`src/core/ports/`** — TypeScript-style interface definitions for `ClaimStore`, `EmbeddingProvider`, `SynthesisEngine`, `AnomalyDetector`, `ProvenanceChain`, `EncryptionProvider`, `IdentityProvider`, `AuditLog`. Each is an abstract class with documented method contracts.

**`src/modules/`** — Concrete adapters: `PostgresClaimStore` (pgvector), `GeminiEmbeddingProvider`, `GroqSynthesisEngine`, `GroqAnomalyDetector`, `Sha256Chain`, `AesGcmEncryptionProvider`, `ApiKeyWalletProvider`, `PostgresAuditLog`, `OkxPaymentClient`, `XLayerAnchor`.

**`src/api/`** — Fastify HTTP layer. `server.js` is the composition root — all port-to-adapter bindings happen here, injected into routes via Fastify plugin options. Error handler registered before all routes (Fastify encapsulation requirement). Rate limiting via `@fastify/rate-limit`. CORS via `@fastify/cors`.

**`reference-consumer/`** — Three-agent reference pipeline demonstrating the full primitive surface: `OnchainFeed` (CEX price), `SignalAnalyst` (DEX price + contradiction), `StrategyWriter` (deny → grant → synthesize). Real x402 payment signing via `onchainos payment pay` CLI shell-out.

---

## Data and Provenance Model

### Claims table

| Column | Type | Notes |
|---|---|---|
| `claim_id` | `TEXT PK` | `syn9_claim_` prefixed nanoid |
| `thread_id` | `UUID` | Groups related claims |
| `writer_identity_id` | `UUID FK → identities` | Resolved at write time, never denormalized |
| `payload` | `TEXT` | AES-256-GCM encrypted JSON: `base64(iv):base64(authTag):base64(ciphertext)` |
| `payload_hash` | `TEXT` | SHA256 of plaintext payload |
| `embedding` | `VECTOR(1536)` | Gemini gemini-embedding-001, RETRIEVAL_DOCUMENT task type |
| `permission_mode` | `TEXT` | `explicit`, `open`, `task_chain` |
| `allowed_wallets` | `TEXT[]` | Populated for `explicit` mode |
| `chain_hash` | `TEXT` | `SHA256(prevHash\|claimId\|payloadHash\|timestamp\|writerIdentityId)` |
| `prev_hash` | `TEXT` | NULL for first claim in thread |
| `scope` | `TEXT` | `session`, `workflow`, `permanent` |
| `expires_at` | `TIMESTAMPTZ` | NULL for permanent |
| `revoked` | `BOOLEAN` | Default false |
| `revoked_at` | `TIMESTAMPTZ` | Set on revoke |

### Cryptographic properties

**Payload confidentiality:** AES-256-GCM with a random 12-byte IV per write. The auth tag provides integrity verification on decryption. The encryption key (`SYN9_ENCRYPTION_KEY`) must be set in the environment — claims cannot be decrypted without it.

**Chain integrity:** The hash chain is tamper-evident, not immutable. The database enforces no constraint preventing a row from being modified — the integrity guarantee is that any modification to a stored claim's `payloadHash`, `timestamp`, or `writerIdentityId` will produce a different `chain_hash`, which will not match the `prev_hash` stored in the next claim. Verification requires recomputing the chain from genesis.

**Embedding asymmetry:** WEAVE uses `RETRIEVAL_DOCUMENT` task type; RECALL uses `RETRIEVAL_QUERY`. Gemini's asymmetric embedding improves retrieval relevance. Vectors are unnormalized at 1536 dims (Gemini's full output is 3072 dims; truncation to 1536 avoids a schema migration). pgvector's `<=>` operator (cosine distance) is normalization-invariant.

### On-chain anchoring

After each research cycle, the latest chain hash is written to XLayer as calldata on a zero-value transaction from a dedicated anchor wallet (`0xF9Bc79aB7133A74A2c0716E9764317287268f2Ea`). The transaction is signed locally using ethers.js with `XLAYER_SIGNER_PRIVATE_KEY` and broadcast via the XLayer RPC. The resulting transaction hash provides an externally verifiable timestamp proof — the chain hash existed at that block's timestamp, verifiable on OKLink without trusting Syn9's database.

---

## Request / Response Flow

The following describes a full three-agent research cycle using the reference pipeline.

**1. Identity registration.** Each agent calls `POST /v1/identities` with a wallet address. A raw API key is returned once (SHA256-hashed for storage). The agent stores both the key and its wallet address for subsequent requests.

**2. OnchainFeed writes.** OnchainFeed fetches the OKB spot price from the OKX CEX public ticker API and calls `POST /v1/threads/:threadId/weave`. The request triggers the x402 payment preHandler: no `X-PAYMENT` header → 402 challenge issued. The agent signs the challenge via `onchainos payment pay --chain xlayer`, retries with the authorization header. The server verifies and settles the payment, then processes the write: embed payload, compute chain hash, encrypt, persist. Response: `entry_id` + `chain_hash`.

**3. SignalAnalyst reads and writes.** SignalAnalyst fetches the OKB DEX aggregator quote from OKX's DEX API (HMAC-signed, same credentials as payment). It calls `POST /v1/threads/:threadId/recall` with intent `"OKB CEX spot price"`. The permission evaluation checks whether SignalAnalyst's wallet is in OnchainFeed's `allowed_wallets` (it is — set at WEAVE time). The result is returned. SignalAnalyst computes divergence, then WEAVEs its own finding. In the background, the anomaly detector embeds the new claim, finds OnchainFeed's claim as a high-similarity candidate, and calls Groq to evaluate contradiction. A conflict record is written to the `conflicts` table.

**4. StrategyWriter — deny → grant → synthesize.** StrategyWriter attempts to RECALL OnchainFeed's raw finding. Its wallet is not in the allow-list → `PERMISSION_DENIED` with `entryExists: true`. The orchestrator (which holds OnchainFeed's identity) calls `POST /v1/threads/:threadId/entries/:entryId/grant` to add StrategyWriter's wallet. StrategyWriter retries RECALL with `synthesis: true`. The permitted result is passed to Groq for synthesis. StrategyWriter assembles the final structured output: `{ opportunity, provenance, contradictions }`.

**5. On-chain anchor.** After the response is sent, the anchor module signs a zero-value XLayer transaction with the latest chain hash as calldata and broadcasts it. The tx hash is logged.

---

## Quickstart

### Prerequisites

- Node.js ≥ 20.0.0
- PostgreSQL with pgvector extension
- API keys: Gemini (embeddings), Groq (synthesis + anomaly detection), OKX Payment API
- `onchainos` CLI (for reference consumer payment signing)

### Installation

```bash
git clone https://github.com/phllp-tanstic/syn9-asp.git
cd syn9-asp
npm install
```

### Environment setup

Copy and populate the environment file:

```bash
cp .env.example .env
```

Minimum required variables for local development:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/syn9
SYN9_API_KEY_SALT=any-random-string
SYN9_ENCRYPTION_KEY=64-char-hex-string
GEMINI_API_KEY=your-gemini-key
GROQ_API_KEY=your-groq-key
```

### Database migration

```bash
npm run migrate
```

### Start the server

```bash
npm run dev        # development (--watch, auto-reload)
npm start          # production
```

### Health check

```bash
curl -X POST https://syn9-asp-production.up.railway.app/v1/health
# {"status":"ok","service":"syn9-asp","version":"0.1.0",...}
```

### Provision an identity

```bash
curl -X POST https://syn9-asp-production.up.railway.app/v1/provision \
  -H "Content-Type: application/json" \
  -d '{"walletAddress": "0xYourWalletAddress"}'
```

Returns API key, auth headers, and ready-to-use request examples.

### Run tests

```bash
npm test                    # unit tests
npm run test:integration    # integration tests (requires live DB)
```

---

## Configuration

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string with pgvector |
| `SYN9_API_KEY_SALT` | Yes | Salt for SHA256 API key hashing. Changing this invalidates all existing keys. |
| `SYN9_ENCRYPTION_KEY` | Yes | AES-256-GCM key for payload encryption. Must be 32 bytes (64 hex chars). Changing this makes all existing claims unreadable. |
| `GEMINI_API_KEY` | Yes | Google Gemini API key for embeddings (`gemini-embedding-001`) |
| `GROQ_API_KEY` | Yes | Groq API key for synthesis and anomaly detection (`llama-3.3-70b-versatile`) |
| `OKX_PAYMENT_API_KEY` | Yes (production) | OKX Payment API key from `web3.okx.com/onchainos/dev-portal` |
| `OKX_PAYMENT_SECRET_KEY` | Yes (production) | OKX Payment API secret |
| `OKX_PAYMENT_PASSPHRASE` | Yes (production) | OKX Payment API passphrase |
| `OKX_PAYMENT_PROJECT_ID` | Yes (production) | OKX Payment project ID |
| `SYN9_AGENT_WALLET` | Yes (production) | Syn9's Agentic Wallet address — `payTo` field in x402 challenges |
| `XLAYER_RPC_URL` | Yes (anchoring) | XLayer RPC endpoint, e.g. `https://rpc.xlayer.tech` |
| `XLAYER_SIGNER_PRIVATE_KEY` | Yes (anchoring) | Private key of the dedicated anchor wallet. Store securely — never commit. |
| `SYN9_WEBHOOK_SIGNING_SECRET` | No | HMAC secret for webhook delivery signatures |
| `PORT` | No | Server port, default `8080` |
| `LOG_LEVEL` | No | Pino log level, default `info` |

---

## API Surface

### Authentication

All endpoints except `/v1/health`, `/v1/provision`, and `/v1/demo/research-cycle` require:

```http
Authorization: Bearer syn9_<key>
X-Agent-Wallet: 0x<wallet>
```

Both headers must match a registered identity. A valid key with a mismatched wallet is rejected.

### Endpoints

| Method | Path | Auth | Payment | Purpose |
|---|---|---|---|---|
| `POST` | `/v1/health` | None | None | Liveness check |
| `POST` | `/v1/identities` | None | None | Register identity, receive API key |
| `POST` | `/v1/provision` | None | None | Self-service onboarding with usage instructions |
| `POST` | `/v1/threads/:id/weave` | Yes | $0.002 | Write claim with provenance |
| `POST` | `/v1/threads/:id/recall` | Yes | $0.00005–$0.001 | Permissioned semantic retrieval |
| `DELETE` | `/v1/threads/:id/entries/:id` | Yes | None | Revoke claim (writer only) |
| `POST` | `/v1/threads/:id/entries/:id/grant` | Yes | None | Grant read access post-hoc |
| `GET` | `/v1/threads/:id/conflicts` | Yes | None | Poll detected contradictions |
| `POST` | `/v1/research-cycles` | Yes | $0.50–$1.00 | Managed multi-source research pipeline |
| `POST` | `/v1/demo/research-cycle` | None | None | Unauthenticated demo, rate-limited 5/hr/IP |
| `GET` | `/` | None | $0.002 | Root x402 probe (OKX marketplace validation) |
| `POST` | `/` | None | $0.002 | Root x402 probe |

### x402 Payment Flow

Endpoints with payment requirements return `402 Payment Required` on unauthenticated requests, with a base64-encoded challenge in the `PAYMENT-REQUIRED` header. The caller signs the challenge using an OKX Agentic Wallet via `onchainos payment pay --payload <base64> --chain xlayer` and retries with the returned authorization in the `payment-signature` header. Settlement is asynchronous on-chain; the server verifies the authorization and queues settlement before proceeding.

---

## Multi-Agent Example

The reference consumer at `reference-consumer/pipeline.js` demonstrates a three-agent DeFi research pipeline. Run it:

```bash
node --env-file=.env reference-consumer/pipeline.js
```

**What it does:**

1. Registers three distinct Syn9 identities (OnchainFeed, SignalAnalyst, StrategyWriter)
2. OnchainFeed fetches the OKB/USDT spot price from the OKX CEX ticker and WEAVEs it — permitted for SignalAnalyst only
3. SignalAnalyst fetches an OKB/USDT DEX aggregator quote from OKX's XLayer DEX API and RECALLs OnchainFeed's finding — Syn9's contradiction detector fires automatically on the divergence
4. StrategyWriter attempts RECALL of OnchainFeed's data → receives `PERMISSION_DENIED` (correctly)
5. The orchestrator calls PERMISSION_GRANT as OnchainFeed's identity to extend access
6. StrategyWriter retries RECALL with `synthesis: true` → succeeds
7. Pipeline assembles structured output: `{ opportunity, provenance, contradictions }`
8. Polls `GET /v1/threads/:id/conflicts` — Groq-generated contradiction summary is returned

The pipeline makes real x402 payments (each WEAVE/RECALL triggers real TEE-signed settlement on XLayer) and produces real on-chain evidence via the anchor module.

---

## Security Model

### Identity and authentication

API keys are generated as `syn9_` + 32 random bytes (hex). Only a salted SHA256 hash is stored. The raw key is returned once at registration and cannot be recovered. Every authenticated request must present both the key (via `Authorization: Bearer`) and the wallet address (via `X-Agent-Wallet`) — a stolen key cannot be replayed under a different wallet identity.

### Authorization

Authorization is evaluated per claim, per request. The `PermissionModePolicy` adapter checks:

- **`explicit` mode:** caller's wallet must appear in `allowed_wallets` or in `permission_grants` for this claim
- **`open` mode:** any authenticated identity
- **`task_chain` mode:** deny-by-default (OKX task membership API is not server-callable; this is a confirmed platform constraint, not a deferred implementation)

Authorization failures on RECALL do not reveal claim content. The `PERMISSION_DENIED` error includes `entryExists: true` to confirm the entry exists, but no payload, hash, or metadata is leaked.

### Payload security

All payloads are encrypted at rest with AES-256-GCM using a random 12-byte IV per operation. The encryption key is an environment variable — it never appears in the database. Losing `SYN9_ENCRYPTION_KEY` means all stored payloads become unreadable. There is no key rotation mechanism in the current implementation.

### Provenance integrity

The hash chain provides tamper-evidence, not tamper-prevention. A database administrator with write access to the `claims` table can modify claim records. The integrity property is: any such modification will break the hash chain, which is detectable by any party who recomputes the chain from the original data. Chain verification is not currently exposed as an API endpoint — this is a roadmap item.

### Known limitations

- No wallet-native signature verification (v1 uses API key + wallet header; TEE-internal signing is not server-verifiable in the current protocol version)
- No key rotation endpoint
- `task_chain` permission mode is not functional (platform API unavailable)
- Grant revocation is not implemented — grants are additive only
- Chain integrity verification endpoint is not implemented
- No multi-tenancy or namespace isolation between different pipeline operators sharing the same deployment

### Security considerations

Do not expose `SYN9_ENCRYPTION_KEY`, `SYN9_API_KEY_SALT`, or `XLAYER_SIGNER_PRIVATE_KEY` in logs, error responses, or version control. The anchor wallet private key controls funds and should be treated with equivalent care to any funded EVM wallet. Rate limits are applied globally (100 req/min) and per-endpoint — the provision endpoint is capped at 10/hr per IP, the demo endpoint at 5/hr per IP.

---

## Trust and Threat Model

**Trusted:** The Syn9 server, its database, and its encryption key. A compromised server or database breaks all guarantees — this is a single-tenant trust model in the current deployment.

**Untrusted by design:** The content of any claim payload (treated as opaque JSON), the wallet addresses of writers and readers (verified as strings only, not via cryptographic signature in v1), and the correctness of any agent's findings (Syn9 records what was said, not whether it was true).

**Threat: malicious writer.** An agent can WEAVE false or misleading information. Syn9 does not validate claim content. Contradiction detection surfaces divergence between sources but does not determine which source is correct.

**Threat: permission misconfiguration.** A writer who sets `mode: "open"` on a sensitive claim makes it readable by any authenticated identity on the same thread. Writers are responsible for their permission choices at WEAVE time.

**Threat: identity spoofing.** In v1, wallet address verification is header-based — a caller can present any wallet address alongside a valid API key for a different wallet, which will fail the `authenticate()` check. A stolen API key cannot be used with an arbitrary wallet, but the binding is enforced by the server, not by cryptographic proof from the client.

**Threat: replay attack on x402 payment.** The `maxTimeoutSeconds: 60` field in x402 challenges limits replay window. OKX's payment verification is expected to enforce this server-side.

**Threat: embedding manipulation.** An adversary who understands the embedding model could craft claim payloads that score high cosine similarity with a target claim, potentially causing the contradiction detector to fire or not fire as desired. This is a known limitation of embedding-based similarity systems.

---

## Deployment

Syn9 is deployed on Railway at `https://syn9-asp-production.up.railway.app`. The deployment uses Nixpacks autodiscovery — no `Dockerfile` or `railway.toml` is required. Railway detects Node.js and runs `npm start` (`node src/api/server.js`).

**Runtime:** Node.js ≥ 20, ESM modules throughout (`"type": "module"` in `package.json`).

**Database:** PostgreSQL with pgvector, provisioned as a separate Railway service in the same project. Connection via `DATABASE_URL`. The `pgvector` extension must be enabled before running migrations.

**Migrations:** `npm run migrate` runs all pending migrations in `src/modules/storage/migrations/`. Migrations are numbered sequentially (002 through 006 currently). Run once at deploy time or on schema changes.

**Environment variables:** All sensitive configuration is managed via Railway's environment variable UI and must be set before the first deploy. The service will crash-loop if `DATABASE_URL`, `SYN9_ENCRYPTION_KEY`, or `SYN9_API_KEY_SALT` are missing.

**Health check:** `POST /v1/health` returns 200 with service metadata. Use this as the Railway health check endpoint and for uptime monitoring.

**Start command:** `node src/api/server.js` — do not use `--env-file=.env` in production (no `.env` file is present on Railway; environment variables are injected directly).

**Operational notes:** The server handles `SIGINT` and `SIGTERM` for graceful shutdown. Orphaned Node processes from development watch sessions can cause `EADDRINUSE` on port 8080 — kill them before restarting. Railway CLI service linking should always be verified with `railway status` before running `railway up` to prevent mislinked deployments.

---

## Repository Structure

```
syn9-asp/
├── src/
│   ├── api/
│   │   ├── server.js                    # Composition root, DI wiring, error handler
│   │   ├── middleware/
│   │   │   ├── auth.js                  # API key + wallet header verification
│   │   │   └── payment.js               # x402 payment preHandler factory
│   │   └── routes/
│   │       ├── health.js                # POST /v1/health
│   │       ├── identities.js            # POST /v1/identities
│   │       ├── provision.js             # POST /v1/provision
│   │       ├── weave.js                 # POST /v1/threads/:id/weave
│   │       ├── recall.js                # POST /v1/threads/:id/recall
│   │       ├── revoke.js                # DELETE /v1/threads/:id/entries/:id
│   │       ├── permission-grant.js      # POST /v1/threads/:id/entries/:id/grant
│   │       ├── conflicts.js             # GET /v1/threads/:id/conflicts
│   │       ├── research-cycles.js       # POST /v1/research-cycles
│   │       ├── demo.js                  # POST /v1/demo/research-cycle
│   │       └── root.js                  # GET+POST / (x402 probe)
│   ├── core/
│   │   ├── domain/
│   │   │   ├── claim.js                 # Claim domain object + ClaimScope enum
│   │   │   ├── conflict.js              # Conflict domain object
│   │   │   ├── errors.js                # Syn9Error hierarchy
│   │   │   ├── id.js                    # Prefixed nanoid generator
│   │   │   └── validate-permission.js   # Permission shape validation
│   │   └── ports/
│   │       ├── claim-store.js
│   │       ├── embedding-provider.js
│   │       ├── synthesis-engine.js
│   │       ├── anomaly-detector.js
│   │       ├── provenance-chain.js
│   │       ├── encryption-provider.js
│   │       ├── identity-provider.js
│   │       └── audit-log.js
│   ├── modules/
│   │   ├── storage/
│   │   │   ├── postgres-client.js       # Shared pg Pool
│   │   │   ├── postgres-claim-store.js  # ClaimStore adapter
│   │   │   ├── migrate.js               # Migration runner
│   │   │   └── migrations/              # 002–006 SQL migration files
│   │   ├── identity/
│   │   │   └── api-key-wallet-provider.js
│   │   ├── authorization/
│   │   │   └── permission-mode-policy.js
│   │   ├── embeddings/
│   │   │   └── gemini-embedding-provider.js
│   │   ├── synthesis/
│   │   │   └── groq-synthesis-engine.js
│   │   ├── anomaly/
│   │   │   └── groq-anomaly-detector.js
│   │   ├── provenance/
│   │   │   └── sha256-chain.js
│   │   ├── encryption/
│   │   │   └── aes-gcm-encryption-provider.js
│   │   ├── audit/
│   │   │   └── postgres-audit-log.js
│   │   ├── payment/
│   │   │   ├── okx-payment-client.js    # HMAC-signed OKX Payment API
│   │   │   └── x402-challenge.js        # 402 challenge builder
│   │   ├── anchor/
│   │   │   └── xlayer-anchor.js         # XLayer on-chain anchoring via ethers.js
│   │   └── webhooks/
│   │       └── webhook-delivery.js      # HMAC-signed, retrying webhook delivery
│   └── config/
│       └── index.js                     # Centralised env var loading
├── reference-consumer/
│   ├── pipeline.js                      # Three-agent orchestrator
│   ├── agents/
│   │   ├── onchain-feed-agent.js        # CEX price source
│   │   ├── signal-analyst-agent.js      # DEX price source + divergence
│   │   └── strategy-writer-agent.js     # Synthesis + structured output
│   ├── lib/
│   │   ├── syn9-client.js               # Syn9Agent class, x402 payment signing
│   │   ├── oklink-client.js             # XLayer on-chain data client
│   │   └── price-feed-client.js         # CEX + DEX price feeds
│   └── scripts/
│       └── test-price-feed.js           # Standalone price feed verification
├── tests/
│   ├── unit/                            # Domain object and module unit tests
│   └── integration/                     # Live DB integration tests
├── package.json
└── REGISTRATION.md                      # Incident log and operational notes
```

---

## Testing

Syn9 uses Node.js's built-in test runner (`node --test`).

```bash
npm test                     # unit tests (no external dependencies)
npm run test:integration     # integration tests (requires DATABASE_URL)
```

**Current coverage:**
- Domain objects: Claim construction, permission validation, error hierarchy
- Sha256Chain: hash computation, chain linking
- AesGcmEncryptionProvider: encrypt/decrypt round-trip, IV uniqueness
- PostgresClaimStore: append, getById, searchBySimilarity, revoke, conflict recording
- ApiKeyWalletProvider: registration, authentication, wallet mismatch rejection
- WEAVE route: payload validation, permission validation, chain hash verification
- RECALL route: similarity search, permission filtering, synthesis flag
- x402 middleware: challenge issuance, payment verification flow

**Not yet covered:**
- Contradiction detection adversarial cases (only happy path tested)
- Concurrent write integrity under simultaneous traffic
- Chain verification across full thread history
- Webhook delivery retry behavior under network failure

---

## OKX AI ASP Integration

Syn9 is registered as an Agent Service Provider on the OKX AI marketplace (Agent ID: 4765, `okx.ai/agents/4765`). It operates as an `A2MCP` service type — an API endpoint accessible to buyers via the OKX AI task system.

**Services:**

| Service | Endpoint | Fee |
|---|---|---|
| Syn9 Research Cycle | `https://syn9-asp-production.up.railway.app` | 0.50 USDT per cycle |
| Syn9 Core API | `https://syn9-asp-production.up.railway.app` | 0.002 USDT per call |

**Buyer flow:** Buyers interact with Syn9 via the OKX AI task system using x402 payment mode. The buyer creates a task, designates Syn9 as the provider, and interacts with the endpoint directly. For self-service access without the task flow, buyers call `POST /v1/provision` with their OKX wallet address to receive API credentials and usage instructions in a single response.

**Task delivery:** x402 tasks (payment mode 3) do not use the `deliver/submit` endpoint. The buyer calls Syn9's endpoint directly and receives the result. Task completion is confirmed by the buyer via `/direct/complete`. Syn9 communicates with buyers via XMTP for task context and delivery confirmation using the `okx-a2a` daemon and XMTP messaging layer.

**A2A communication:** Syn9's communication address is `0xe551f1679ebF8Dd3A614DACFa5bC13144d13539B`. The `okx-a2a` daemon must be running for A2A message delivery. Inbound task notifications are received as XMTP messages and processed manually or via an automated listener.

---

## Roadmap

### Current — implemented and deployed

- WEAVE, RECALL, REVOKE, PERMISSION_GRANT primitives
- SHA256 hash-linked provenance chain
- AES-256-GCM payload encryption at rest
- Gemini embedding-based semantic retrieval (pgvector)
- Per-entry permission model (explicit, open)
- Groq-based contradiction detection (fire-and-forget)
- Groq-based synthesis on RECALL
- x402 payment gating (WEAVE, RECALL, research cycles)
- Per-cycle billing via `POST /v1/research-cycles`
- Self-service provisioning via `POST /v1/provision`
- Unauthenticated demo endpoint `POST /v1/demo/research-cycle`
- On-chain anchoring to XLayer (automatic, per research cycle)
- Webhook delivery for conflict notifications
- Conflict polling endpoint
- Audit log (separately chained)
- OKX AI marketplace listing (Agent ID 4765, two services)
- Reference consumer pipeline (three agents, real x402 payments)

### Planned

- Chain integrity verification endpoint (`GET /v1/threads/:id/verify`)
- API key rotation
- Grant revocation
- `task_chain` permission mode (blocked on OKX platform API availability)
- Automated A2A task listener (persistent daemon, replaces manual XMTP handling)
- On-chain claim anchoring (individual claim hashes, not just cycle-level)
- Dispute-mode RECALL (returns conflicting entries alongside synthesis)
- Load and concurrency testing
- Adversarial contradiction detection test suite

---

## Design Principles

**Provenance over anonymous state.** Every write is attributed. The identity of the writer is a first-class property of the claim, not an application-level annotation.

**Authorization before retrieval.** Permission is evaluated per entry, per request. There is no global read access to a thread — access to each entry is determined independently.

**Shared context without unrestricted access.** Multiple agents can write to the same thread. That does not mean every agent can read every entry. The permission model exists precisely because shared pipelines involve agents with different trust levels.

**Cryptographic integrity where trust matters.** The hash chain and payload encryption are not optional features — they are the mechanism by which Syn9's provenance guarantees are verifiable by parties who do not trust the database alone.

**Interfaces over infrastructure lock-in.** Every concrete dependency is injected through a port interface. Swapping the embedding provider, the LLM, or the storage backend requires changing one line in `server.js`, not modifying domain logic.

**Auditability as a first-class primitive.** The audit log is a separately chained record of every significant operation. It is not an afterthought or a logging side-effect.

**Explicit trust boundaries between agents.** Syn9 does not assume that agents in the same pipeline trust each other. The permission model, the attribution system, and the contradiction detector exist because that assumption is false in real multi-agent systems.

---

## Contributing

### Development setup

```bash
git clone https://github.com/phllp-tanstic/syn9-asp.git
cd syn9-asp
npm install
cp .env.example .env
# Populate .env with development credentials
npm run migrate
npm run dev
```

### Branch workflow

Branch from `master`. Use descriptive branch names: `feat/`, `fix/`, `docs/`. Open a pull request against `master`. All tests must pass before merge.

### Coding expectations

- ESM modules throughout — no `require()`
- No concrete infrastructure imports in `src/core/` — ports only
- New modules must implement the relevant port interface
- New routes must receive dependencies via Fastify plugin options, not via direct import
- Error handler in `server.js` must remain registered before route plugins
- All environment variable access through `src/config/index.js` — no `process.env` reads in other modules

### Tests

Add unit tests for new domain logic in `tests/unit/`. Add integration tests for new routes or store methods in `tests/integration/`. Run the full suite before opening a pull request.

---

## License

MIT — see `package.json`.