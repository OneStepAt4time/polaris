# Polaris

> Self-hosted **observatory and control plane** for your AI coding agents.

Polaris watches your Claude Code activity, alerts you before you hit a rate
limit or blow a daily budget, and lets you delegate work to Claude Code from
any device via a small REST + WebSocket API.

The dashboard is inspired by [CCMeter](https://github.com/hmenzagh/CCMeter) —
KPIs, project cards with sparklines, a GitHub-style activity heatmap, live
rate-limit bars. The alerting and ACP control-plane layer is what Polaris
adds on top.

**Status**: alpha, daily-driver-quality for the maintainer. MIT.

---

## What Polaris does today (v0.14.0)

### Observatory

- Ingests `~/.claude/projects/**/*.jsonl` live via a filesystem watcher
- Dedupes by `requestId` (parity with CCMeter)
- Computes per-model cost using a versioned [pricing table](./pricing/anthropic.json)
- Web dashboard with:
  - KPI banner (cost / events / token totals) for 1h / 12h / today / 7d / 30d / all
  - **Projects** grid with 30-day cost sparkline per project
  - **Activity heatmap** GitHub-style (4 metrics: cost / events / output tokens / sessions)
  - **Rate-limit bars** for every Anthropic OAuth window (5-hour, 7-day, etc.)
  - **Sessions tab** with live SSE event stream + inline approval buttons

### Alerting (3 channels, 3 rules)

- **Channels**: Telegram (bot), Slack (webhook), Discord (webhook). Polaris
  fans out to all configured channels in parallel; the alert is marked sent
  as soon as at least one channel delivers.
- **Rules**:
  - `cost-threshold-daily` — fires when today's spend crosses a USD ceiling
  - `rate-limit-near` — fires when any Anthropic usage window crosses a `%`
    utilization threshold (one alert per window per UTC day)
  - `daily-summary` — once per UTC day at 23:00, posts a digest with today's
    cost + events + output tokens + top-3 projects

### Control plane (ACP)

- Spawns Claude Code via the Agent Client Protocol (JSON-RPC over stdio)
- Multi-turn sessions with approval handshake (tool-permission requests)
- SSE event stream of session updates
- REST API for `/v1/sessions`, `/v1/sessions/:id/messages`, etc.

---

## Quick start

### Docker (recommended)

```bash
docker run -d --name polaris \
  -p 9180:9180 \
  -e POLARIS_AUTH_TOKEN="$(openssl rand -hex 32)" \
  -e POLARIS_PORT=9180 \
  -v polaris-data:/data \
  -v ~/.claude:/claude:ro \
  ghcr.io/onestepat4time/polaris:v0.14.0
```

Open <http://localhost:9180>, paste the token, you're in.

### Docker Compose

A copy-paste-ready example lives at [`examples/docker-compose.yml`](./examples/docker-compose.yml):

```bash
git clone https://github.com/OneStepAt4time/polaris.git
cd polaris/examples
# Edit POLARIS_AUTH_TOKEN in docker-compose.yml
docker compose up -d
```

### From source

```bash
git clone https://github.com/OneStepAt4time/polaris.git
cd polaris
npm install
npm run build
POLARIS_AUTH_TOKEN="$(openssl rand -hex 32)" \
POLARIS_PORT=9180 \
  node dist/server.js
```

---

## Adding notifications

See **[`docs/notifications.md`](./docs/notifications.md)** for the full
walkthrough of Telegram / Slack / Discord setup and which rules fire when.

Short version — to be DM'd on Telegram when today's spend hits $20:

```bash
POLARIS_TELEGRAM_BOT_TOKEN=123456789:ABC...
POLARIS_TELEGRAM_CHAT_ID=987654321
POLARIS_DAILY_COST_THRESHOLD_USD=20
```

To also be warned when any rate-limit window hits 80%:

```bash
POLARIS_RATE_LIMIT_NEAR_THRESHOLD_PCT=80
```

Both rules dedupe per UTC day so you don't get spammed across engine ticks.

---

## API

- `GET /health` — unauthenticated liveness + service version
- `GET /v1/metrics?range=1h|12h|today|7d|30d|all` — totals + per-model breakdown
- `GET /v1/projects?days=30` — per-project totals + daily-cost sparkline data
- `GET /v1/heatmap?days=180&metric=cost|events|outputTokens|sessions` — heatmap data
- `GET /v1/rate-limits` — latest Anthropic OAuth `/api/oauth/usage` sample
- `POST /v1/ingest` — push a JSONL session (used by the live watcher + backfill)
- ACP routes — see [docs/quickstart.md](./docs/quickstart.md)

All `/v1/*` routes require `Authorization: Bearer <POLARIS_AUTH_TOKEN>`.

---

## Why Polaris exists

Polaris ports the information architecture of CCMeter (excellent TUI for
Claude Code analytics) to a remote-accessible web UI, adds **multi-channel
alerting**, and is built to extend to other AI coding agents in v2.

Polaris **does not replace CCMeter**: if you only want a local TUI for
Claude Code analytics, CCMeter is the better tool. Polaris wins when you
want:

- Notifications on your phone (Telegram / Slack / Discord) when you cross a
  cost threshold or approach a rate limit
- A web dashboard you can open from any device
- Multi-machine aggregation (laptop + workstation + server in one view)
- Programmatic delegation to Claude Code (the ACP control-plane layer)

---

## Quick links

- **[CHARTER.md](./CHARTER.md)** — vision, scope, architecture, dev rules, roadmap (authoritative)
- **[docs/quickstart.md](./docs/quickstart.md)** — full install + first session walkthrough
- **[docs/notifications.md](./docs/notifications.md)** — channel + rule configuration
- **[examples/docker-compose.yml](./examples/docker-compose.yml)** — ready-to-edit Compose file
- **[examples/vibe-coder.mjs](./examples/vibe-coder.mjs)** — minimal Node client driving Polaris from the terminal
- **[LICENSE](./LICENSE)** — MIT

---

## Roadmap

| Milestone | Status | Goal |
|---|---|---|
| **M0** Foundation | shipped (v0.1.0) | JSONL ingest + SQLite + basic web page |
| **M1** MVP | mostly shipped (v0.14.0) | CCMeter-parity web UI + Telegram/Slack/Discord alerts |
| **M2** Beta | next | Email + second agent (Cursor) + retention + public docs |

See [CHARTER.md §9](./CHARTER.md) for the full deliverable list.

## License

MIT — see [LICENSE](./LICENSE).
