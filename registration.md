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