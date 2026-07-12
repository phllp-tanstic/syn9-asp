# Syn9 — OKX AI ASP Registration Record

Durable record of registration artifacts. Terminal scrollback is not a
source of truth — this file is.

## Identity

| Field | Value |
|---|---|
| Agent Name | Syn9 |
| Agent ID | `4765` |
| Role | ASP |
| Owner / Agent Wallet | `0x929f42eacc298afa6febc3d6a869fcf8e0ca37cb` |
| Chain | XLayer (chainIndex 196) |
| Communication Address | `0xe551f1679ebF8Dd3A614DACFa5bC13144d13539B` |

## Registration transaction

| Field | Value |
|---|---|
| `agent create` tx hash | `0xab2f49cb507f5322538931789cf97df9b1a499681ac621c86b5b509bbce56473` |
| Registered | 2026-07-09 |

## Deployed endpoint

| Field | Value |
|---|---|
| Production URL | https://syn9-asp-production.up.railway.app |
| Health check | `POST /v1/health` — verified 200 OK |
| Hosting | Railway |

## Listed service (at registration)

Registered with one representative A2MCP service entry. Real WEAVE/RECALL/
REVOKE routes don't exist yet as of this registration — only `/v1/health`.
This entry will be expanded/corrected via `agent update` once those routes
ship (Day 2–3).

```json
{
  "serviceName": "Syn9 Core API",
  "serviceDescription": "WEAVE/RECALL/REVOKE endpoints for provenance-verified, permissioned agent context",
  "serviceType": "A2MCP",
  "fee": "0.002",
  "endpoint": "https://syn9-asp-production.up.railway.app"
}
```

## Avatar

CDN URL: https://static.okx.com/cdn/web3/wallet/marketplace/headimages/agent/avatar/350e0428-9ebb-4ba3-acd9-ba3ea037c803.png

## Approval status log

| Date | Status | Note |
|---|---|---|
| 2026-07-09 | Listing under review | `approvalRemark: "AI quality review suggested pass"` |

Update this table each time you check status — don't just overwrite, append,
so there's a record of how long review took (relevant if R1 in the
blueprint's risk register ever needs revisiting).

## How to check current status

```powershell
onchainos agent get-my-agents --role asp
```

Or via the web dashboard at https://www.okx.ai (connect the same wallet).

## Incident: production outage, July 9–12

Between initial registration (July 9) and July 12, the deployed service
was very likely crash-looping or partially broken due to a chain of
compounding issues, discovered and fixed together on July 12:

1. `npm start` used `node --env-file=.env`, which throws fatally if
   `.env` doesn't exist — Railway has no `.env` file (git-ignored,
   never deployed), so every deploy after this flag was added
   crash-looped on boot.
2. Once fixed, the app crashed again on missing `SYN9_ENCRYPTION_KEY`
   and other secrets — these existed locally but were never pushed to
   Railway's environment.
3. The local Railway CLI was discovered to be linked to the `Postgres`
   service, not `syn9-asp` — meaning several `railway variables --set`
   commands run without an explicit `--service` flag had been silently
   landing on the wrong service.
4. The app's `PORT` was resolving to `5432` (Postgres's port) rather
   than `8080`, traceable to the same mislinked-CLI issue.
5. The bare root URL (`/`, the exact URL registered as this ASP's
   service endpoint) had no route at all and 404'd — separately fixed
   by adding a root response route.

All five are now fixed and verified: `POST /v1/health` and `GET /`
both confirmed returning 200 from the live production URL as of
2026-07-12.

**Implication for OKX review:** the ASP's registered endpoint was very
likely unreachable or broken for some or all of the review window
(July 9–12), which may explain why review has remained at "Listing
under review" well past OKX's stated 24-hour SLA. Worth mentioning
this explicitly if/when contacting OKX support.