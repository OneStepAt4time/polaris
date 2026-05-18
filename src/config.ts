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
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse({
    authToken: env.POLARIS_AUTH_TOKEN,
    host: env.POLARIS_HOST,
    port: env.POLARIS_PORT,
    dbPath: env.POLARIS_DB_PATH,
  });
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid Polaris configuration:\n${issues}`);
  }
  return parsed.data;
}
