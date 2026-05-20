# Notifications

Polaris ships three notification channels (Telegram, Slack, Discord) and
three rules. The rules engine runs every 5 minutes and fans out each match
to every configured channel in parallel; an alert is marked sent as soon as
at least one channel succeeds (failures retry on the next tick).

## Env vars at a glance

| Env var | Default | Effect |
|---|---|---|
| `POLARIS_TELEGRAM_BOT_TOKEN` | `""` | Token from `@BotFather`. Empty = Telegram channel off. |
| `POLARIS_TELEGRAM_CHAT_ID` | `""` | Destination DM / group / channel ID. |
| `POLARIS_SLACK_WEBHOOK_URL` | `""` | Slack incoming-webhook URL. Empty = Slack channel off. |
| `POLARIS_DISCORD_WEBHOOK_URL` | `""` | Discord webhook URL. Empty = Discord channel off. |
| `POLARIS_DAILY_COST_THRESHOLD_USD` | `0` | Daily $ ceiling. `0` = cost-threshold rule off. |
| `POLARIS_RATE_LIMIT_NEAR_THRESHOLD_PCT` | `0` | % utilization ceiling on Anthropic windows. `0` = rule off. |

The rules engine only starts when **at least one channel** is configured
AND **at least one rule** has a non-zero threshold. The `daily-summary`
rule is enabled implicitly when the engine starts (no separate env var).

## Channels

### Telegram

1. In Telegram, message [`@BotFather`](https://t.me/BotFather), `/newbot`,
   follow the prompts, save the bot token.
2. Start a conversation with your new bot (otherwise it can't DM you).
3. Visit `https://api.telegram.org/bot<TOKEN>/getUpdates` in a browser,
   look for `"chat":{"id":<YOUR_ID>,...}`, save that chat ID.
4. Set env vars:
   ```bash
   POLARIS_TELEGRAM_BOT_TOKEN=123456789:ABC...
   POLARIS_TELEGRAM_CHAT_ID=987654321
   ```
5. Polaris messages use Markdown (`parse_mode: Markdown`).

### Slack

1. In your Slack workspace, **Apps** → **Incoming Webhooks** → **Add to
   Slack** → pick a channel → copy the webhook URL.
2. Set env var:
   ```bash
   POLARIS_SLACK_WEBHOOK_URL=https://hooks.slack.com/services/T/X/Y
   ```
3. Polaris posts plain text (no formatting).

### Discord

1. In your server, **Server Settings** → **Integrations** → **Webhooks** →
   **New Webhook** → pick a channel → copy the webhook URL.
2. Set env var:
   ```bash
   POLARIS_DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/123/abc
   ```
3. Polaris posts plain text.

## Rules

### `cost-threshold-daily`

Fires when today's aggregated cost (UTC midnight → now) crosses
`POLARIS_DAILY_COST_THRESHOLD_USD`. Dedup key is the UTC day, so you get
one alert per day even if the engine ticks 280 times after the crossing.

```
*Polaris* — daily cost threshold crossed

Today's spend: `$21.47`
Threshold: `$20.00`
Events today: `354`
```

### `rate-limit-near`

Fires when any Anthropic OAuth `/api/oauth/usage` window crosses
`POLARIS_RATE_LIMIT_NEAR_THRESHOLD_PCT` (default `0` = disabled). Polaris
auto-normalizes `0..1` and `0..100` utilization formats and iterates every
window the API exposes — including ones not documented in CCMeter
(`seven_day_sonnet`, `seven_day_omelette`, etc.).

Requires `~/.claude/.credentials.json` to be readable (the rate-limit
poller is only started when OAuth credentials are present). Dedup key is
`<window_key>:<UTC-day>`, so each window fires at most once per day.

```
*Polaris* — rate limit near

Window: `five_hour`
Utilization: `95%`
Threshold: `80%`
```

### `daily-summary`

Fires once per UTC day at 23:00. Active automatically when the engine
runs (no separate env var). Posts a digest with today's totals plus the
top-3 projects ranked by cost.

```
*Polaris* — daily summary (2026-05-20)

Cost: `$37.42`
Events: `1854`
Output tokens: `1.4M`

Top projects today:
1. `D--polaris` — `$24.10`
2. `D--aegis` — `$9.32`
3. `D--other` — `$4.00`
```

If today has zero events, the rule stays silent — no alert spam on idle
days.

## Verification

```bash
# 1. Boot Polaris with everything configured.
POLARIS_AUTH_TOKEN="..." \
POLARIS_TELEGRAM_BOT_TOKEN="..." \
POLARIS_TELEGRAM_CHAT_ID="..." \
POLARIS_SLACK_WEBHOOK_URL="..." \
POLARIS_DAILY_COST_THRESHOLD_USD=0.01 \
POLARIS_RATE_LIMIT_NEAR_THRESHOLD_PCT=80 \
  node dist/server.js

# 2. Within ~5 minutes you should see:
#    - A cost-threshold alert (if today's spend >= $0.01) on Telegram + Slack
#    - A rate-limit-near alert per window above 80%
#    - At 23:00 UTC, the daily-summary digest

# 3. Server logs each dispatch:
#    [rules] sent cost-threshold-daily (2026-05-20) via telegram,slack
#    [rules] sent rate-limit-near:five_hour (2026-05-20) via telegram,slack
```

## Channel resilience

`Promise.all` fans out to every channel in parallel. If Telegram is rate-
limited and Slack succeeds, the rule is still marked sent for today and
the failure is logged:

```
[rules] sent cost-threshold-daily (2026-05-20) via slack
[rules] cost-threshold-daily partial failure on telegram: 429 Too Many Requests
```

If every channel fails, `wasNotified` stays `false` and the next tick
retries — so a 5-minute Slack outage doesn't lose your alert.
