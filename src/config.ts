import { z } from "zod";

const ConfigSchema = z.object({
  // why: shared bearer token for API auth (ADR-0004). Required, min 8 chars.
  authToken: z.string().min(8, "POLARIS_AUTH_TOKEN must be at least 8 chars"),
  // why: HTTP bind address. Default 127.0.0.1 so a misconfigured deploy isn't network-exposed.
  host: z.string().default("127.0.0.1"),
  // why: HTTP port. Default 3000.
  port: z.coerce.number().int().positive().default(3000),
  // why: SQLite file path. Use ":memory:" for ephemeral testing (ADR-0002).
  dbPath: z.string().default("./polaris.db"),
  // why: directory whose **/*.jsonl files are watched and ingested live.
  //       Default ~/.claude/projects. Set to empty string to disable the
  //       watcher (useful for headless ACP-only use of Polaris, v0.3+).
  //       Path is expanded with $HOME ("~/..." → /home/<user>/...).
  watchDir: z.string().default("~/.claude/projects"),
  // why: command to spawn for the ACP child process (parsed as a shell-split
  //       string; no quoting). Empty string ("") = auto-resolve the bundled
  //       @agentclientprotocol/claude-agent-acp via Node module resolution.
  //       Tests point this at a fixture script so the gate doesn't need a real
  //       `claude` install. ADR-0010 v0.3 ACP-A.
  acpBin: z.string().default(""),
  // why: Telegram bot HTTP API token for the cost-threshold notification
  //       channel. Empty = channel disabled (no notifications fire). v0.7.0.
  telegramBotToken: z.string().default(""),
  // why: Telegram chat or channel ID to deliver alerts to. Empty = disabled.
  telegramChatId: z.string().default(""),
  // why: daily USD ceiling — when today's aggregated cost crosses it,
  //       Polaris fires one Telegram alert (deduped per UTC day via the
  //       notifications_sent table). 0 = disabled. v0.7.0.
  dailyCostThresholdUsd: z.coerce.number().nonnegative().default(0),
  // why: % utilization on any Anthropic rate-limit window above which
  //       Polaris fires a Telegram alert (one per window per UTC day).
  //       Requires OAuth credentials at ~/.claude/.credentials.json so the
  //       rate-limit poller has samples to evaluate. 0 = disabled. v0.10.0.
  rateLimitNearThresholdPct: z.coerce.number().nonnegative().default(0),
  // why: Slack incoming-webhook URL. When set, alerts are delivered to Slack
  //       in addition to any other configured channel. Empty = disabled.
  //       v0.12.0.
  slackWebhookUrl: z.string().default(""),
  // why: Discord webhook URL. Polaris fan-outs to every configured channel;
  //       a rule is marked sent as soon as at least one channel delivers.
  //       Empty = disabled. v0.12.0.
  discordWebhookUrl: z.string().default(""),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse({
    authToken: env.POLARIS_AUTH_TOKEN,
    host: env.POLARIS_HOST,
    port: env.POLARIS_PORT,
    dbPath: env.POLARIS_DB_PATH,
    watchDir: env.POLARIS_WATCH_DIR,
    acpBin: env.POLARIS_ACP_BIN,
    telegramBotToken: env.POLARIS_TELEGRAM_BOT_TOKEN,
    telegramChatId: env.POLARIS_TELEGRAM_CHAT_ID,
    dailyCostThresholdUsd: env.POLARIS_DAILY_COST_THRESHOLD_USD,
    rateLimitNearThresholdPct: env.POLARIS_RATE_LIMIT_NEAR_THRESHOLD_PCT,
    slackWebhookUrl: env.POLARIS_SLACK_WEBHOOK_URL,
    discordWebhookUrl: env.POLARIS_DISCORD_WEBHOOK_URL,
  });
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid Polaris configuration:\n${issues}`);
  }
  return parsed.data;
}
