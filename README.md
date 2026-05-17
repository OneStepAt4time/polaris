# Polaris

> Self-hosted analytics & alerts for your AI coding agents.

Polaris is the **self-hosted observatory for your AI coding agents**: see tokens, costs, rate-limits and activity for Claude Code (and others, coming in v2) in a web dashboard inspired by [CCMeter](https://github.com/hmenzagh/CCMeter), with notifications via Telegram, Slack, or Discord — *before* you burn the budget or hit a rate limit.

**Status**: Pre-alpha (M0 backend in place, UI pending).

---

## Quick start (Docker)

```bash
docker run --rm \
  -e POLARIS_AUTH_TOKEN="$(openssl rand -hex 32)" \
  -v polaris-data:/data \
  -v ~/.claude:/claude:ro \
  -p 3000:3000 \
  ghcr.io/onestepat4time/polaris:latest
```

Then ingest a JSONL session:

```bash
TOKEN=...   # the same token you passed via POLARIS_AUTH_TOKEN
curl -X POST http://localhost:3000/v1/ingest \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"sessionFile\":\"my-session\",\"content\":$(jq -Rs . < ~/.claude/projects/<some>.jsonl)}"
```

And query metrics:

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/v1/metrics?range=today" | jq
```

`/health` is unauthenticated for liveness probes; everything under `/v1/*` requires the bearer token.

The `:latest` tag tracks the most recent release; pin a specific tag (e.g. `:0.1.0`) in production.

---

## Quick links

- **[CHARTER.md](./CHARTER.md)** — vision, scope, architecture, dev rules, roadmap (authoritative)
- **[LICENSE](./LICENSE)** — MIT

---

## Why Polaris exists

Polaris ports the information architecture of [CCMeter](https://github.com/hmenzagh/CCMeter) (excellent TUI for Claude Code analytics) to a **remote-accessible web UI**, adds **multi-channel alerting**, and is built to extend to other AI coding agents in v2.

Polaris **does not replace CCMeter**: if you only want a local TUI for Claude Code analytics, CCMeter is the better tool. Polaris wins when you want:
- Notifications on your phone (Telegram / Slack / Discord) when you cross a cost threshold or approach a rate limit
- A web dashboard you can open from any device
- Multi-machine aggregation (laptop + workstation + server in one view)

## Roadmap

| Milestone | Goal | Target |
|---|---|---|
| **M0** Foundation | JSONL ingest + SQLite + basic web page | 1 week |
| **M1** MVP | CCMeter-parity web UI + Telegram/Slack/Discord alerts | 3-4 weeks after M0 |
| **M2** Beta | Email + second agent (Cursor) + retention + public docs | 1-2 months after MVP |

See [CHARTER.md §9](./CHARTER.md) for details.

## License

MIT — see [LICENSE](./LICENSE).
