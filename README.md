# Syn9

> Provenance-verified, permissioned collaborative state for multi-agent workflows on OKX AI.

**Status:** Early build. Core write/read paths under active development. Not yet feature-complete — see [Roadmap](#roadmap).

## The problem in one sentence

Multi-ASP workflows have no shared, trustworthy state layer — agents either
re-inject full context at every handoff (expensive, no access control) or
lose context entirely (unreliable). Syn9 is the missing layer.

## What Syn9 does

Three primitives:

- **WEAVE** — write with cryptographic provenance: chained hash, writer
  identity, contradiction detection against prior claims.
- **RECALL** — task-aware, identity-gated retrieval. Returns a synthesized,
  permission-filtered view — not a raw record dump.
- **REVOKE** — immediate expiry with a final chain hash.

Every write is an attributable, immutable Claim — not a chat message,
not a generic memory blob — chained into a tamper-evident provenance log.
Every read is authorized against the requesting agent's identity and logged
for on-chain-anchored audit.

*(Full API reference lands here once WEAVE/RECALL/REVOKE routes ship —
tracked in the roadmap below.)*

## Quickstart

```bash
curl -X POST https://syn9-asp-production.up.railway.app/v1/health
```

*(WEAVE/RECALL quickstart example lands here once those endpoints exist.)*

## Live demo

*(Link to demo video — Day 7-8.)*

## Architecture

Ports-and-adapters. Core domain (`src/core`) defines interfaces — identity,
authorization, claim storage, provenance chaining, synthesis, audit — with
zero knowledge of Postgres, Fastify, or any specific vendor. Concrete
implementations live in `src/modules` and are wired together at the
composition root (`src/api/server.js`), so any dependency (storage engine,
LLM provider, chain) is swappable without touching call sites.

*(Diagram lands here — Day 7.)*

## Pricing

*(Table lands here once payment metering ships — Day 4.)*

## Why not Mem0/Zep?

Different category. Mem0/Zep/Letta/LangMem assume single-agent memory with
unconstrained access. Syn9 assumes the opposite: multiple agents, different
owners, explicit trust boundaries, cryptographic provenance on every write.

## Roadmap

- [ ] WEAVE endpoint (write path)
- [ ] RECALL endpoint (read path)
- [ ] REVOKE endpoint
- [ ] Async anomaly / conflict detection
- [ ] Opt-in synthesis on RECALL
- [ ] x402 payment metering
- [ ] XLayer on-chain audit anchor
- [ ] Reference consumer (three-agent DeFi due diligence pipeline)
- v2: Declarative permission language
- v2: Memory compression for long-running workflows
- v3: Cross-workflow context inheritance

## Registration

Registered as an OKX AI ASP — see [`REGISTRATION.md`](./REGISTRATION.md)
for agent ID, transaction record, and current approval status.

## License

MIT