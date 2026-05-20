# Quickstart

End-to-end walkthrough: install Polaris, see your first metrics, configure
notifications, run a remote session.

## 1. Install

Pick one of these three paths.

### Docker (single command)

```bash
docker run -d --name polaris \
  -p 9180:9180 \
  -e POLARIS_AUTH_TOKEN="$(openssl rand -hex 32)" \
  -e POLARIS_PORT=9180 \
  -v polaris-data:/data \
  -v ~/.claude:/claude:ro \
  ghcr.io/onestepat4time/polaris:v0.14.0
```

Print the token you generated (it's in `docker logs polaris` near the top of
the boot output) and open <http://localhost:9180>.

### Docker Compose

```bash
git clone https://github.com/OneStepAt4time/polaris.git
cd polaris/examples
$EDITOR docker-compose.yml          # edit POLARIS_AUTH_TOKEN
docker compose up -d
docker compose logs -f polaris
```

### From source (Node 22+)

```bash
git clone https://github.com/OneStepAt4time/polaris.git
cd polaris
npm install
npm run build
POLARIS_AUTH_TOKEN="$(openssl rand -hex 32)" \
POLARIS_PORT=9180 \
POLARIS_DB_PATH=./polaris.db \
POLARIS_WATCH_DIR="$HOME/.claude/projects" \
  node dist/server.js
```

## 2. See your metrics

The first time you open the dashboard you'll see empty KPIs because Polaris
only watches new JSONL appends. To backfill your full history:

```bash
TOKEN="..."   # the same token you set in POLARIS_AUTH_TOKEN
PORT=9180

for f in ~/.claude/projects/**/*.jsonl; do
  curl -s -X POST "http://localhost:$PORT/v1/ingest" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"sessionFile\":\"$f\",\"content\":$(jq -Rs . < "$f")}" \
    > /dev/null
done
```

Refresh the dashboard — KPIs, projects, the heatmap, and the per-model
breakdown should now have real data.

If you've also got `~/.claude/.credentials.json` (you do if you've ever run
`claude` from this machine), the **Rate limits** section starts filling
within ~10 seconds of boot, with one bar per Anthropic usage window
(5-hour, 7-day, etc.).

## 3. Set up notifications

See [notifications.md](./notifications.md) for the full setup of Telegram,
Slack, and Discord channels, plus the three built-in rules
(`cost-threshold`, `rate-limit-near`, `daily-summary`).

## 4. Drive Claude Code from the API

Polaris exposes Claude Code as an HTTP/SSE control plane. The simplest demo
is the [`examples/vibe-coder.mjs`](../examples/vibe-coder.mjs) client (~150
lines, zero deps beyond Node 22):

```bash
POLARIS_URL=http://localhost:9180 \
POLARIS_AUTH_TOKEN="$TOKEN" \
POLARIS_CLIENT_CWD="$(pwd)" \
  node examples/vibe-coder.mjs "explain the architecture of this repo"
```

The script:
1. `POST /v1/sessions` with your `cwd` to create a Claude Code session
2. Opens an SSE stream on `/v1/sessions/:id/events` to watch updates live
3. `POST /v1/sessions/:id/messages` to send the prompt
4. Answers permission requests interactively (`y/N` prompts on stdin)
5. Closes the session on exit

You can also use the Sessions tab in the web UI for the same flow with a
graphical Allow/Allow once/Deny picker.

## 5. Verify

```bash
curl -s http://localhost:9180/health | jq .
# {"status":"ok","service":"polaris","version":"0.14.0"}

curl -s -H "Authorization: Bearer $TOKEN" \
  http://localhost:9180/v1/metrics?range=today | jq '.totals'
# {"events": ..., "costUsd": ..., ...}

curl -s -H "Authorization: Bearer $TOKEN" \
  http://localhost:9180/v1/rate-limits | jq '.payload'
# {"five_hour":{"utilization":...}, "seven_day":{...}, ...}
```

## Next steps

- [`notifications.md`](./notifications.md) — channel and rule configuration
- [`CHARTER.md`](../CHARTER.md) — vision, scope, roadmap
- [`docs/adr/`](./adr) — architecture decisions
