# Polaris

> Self-hosted **lean control plane** for your AI coding agents.

Polaris lets other agents, tools, or humans **delegate work to Claude Code** (and future agents) through an API that mirrors the interactive TUI: multi-turn conversation, approval handshake, session resume, streamed events. A web dashboard inspired by [CCMeter](https://github.com/hmenzagh/CCMeter) shows tokens, costs and activity live.

Polaris converges on Aegis's original mission (control plane for Claude Code) but is rebuilt lean from scratch — see [ADR-0010](./docs/adr/0010-acp-control-plane.md) and [CHARTER.md](./CHARTER.md).

**Status**: Alpha. **v0.1.0** ships the observatory baseline (JSONL ingest + metrics + Astro web UI + Docker). The control-plane via ACP rolls out across v0.3-v0.5 (see [roadmap](./CHARTER.md)).

---

## Quick start (Docker)

```bash
docker run --rm \
  -e POLARIS_AUTH_TOKEN="$(openssl rand -hex 32)" \
  -v polaris-data:/data \
  -v ~/.claude:/claude:ro \
  -p 3000:3000 \
  ghcr.io/onestepat4time/polaris:0.1.0
```

> Pin an explicit version tag (`:0.1.0`) for reproducible deployments. A floating `:latest` becomes available from v0.1.1 onward (see this PR's `metadata-action` `latest=true` fix).

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
