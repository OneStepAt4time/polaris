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
  });
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid Polaris configuration:\n${issues}`);
  }
  return parsed.data;
}
