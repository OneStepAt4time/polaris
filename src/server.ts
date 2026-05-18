import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sensible from "@fastify/sensible";
import staticPlugin from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import { createAcpJsonRpcClient } from "./acp/json-rpc-client.js";
import { type AcpProcessHandle, spawnAcpProcess } from "./acp/spawner.js";
import { registerAuth } from "./auth.js";
import { type Config, loadConfig } from "./config.js";
import { type PolarisDb, openDb } from "./db.js";
import { ingest } from "./ingest/ingest.js";
import { type WatcherHandle, startWatcher } from "./ingest/jsonl-watcher.js";
import { type TimeRange, aggregate, resolveRange } from "./metrics/aggregator.js";
import { loadPricing } from "./metrics/pricing.js";

const IngestBodySchema = z.object({
  sessionFile: z.string().min(1),
  content: z.string(),
});

const RangeSchema = z.enum(["today", "7d", "30d", "all"]).default("today");

export interface BuildResult {
  app: FastifyInstance;
  config: Config;
  db: PolarisDb;
}

function findUiRoot(): string | null {
  // Walk up from this module until we find a package.json — that's the project
  // root. The UI lives at <root>/dist/ui (produced by `npm run build:ui`).
  let dir = dirname(fileURLToPath(import.meta.url));
  while (dir !== dirname(dir)) {
    if (existsSync(resolve(dir, "package.json"))) {
      const candidate = resolve(dir, "dist", "ui");
      return existsSync(candidate) ? candidate : null;
    }
    dir = dirname(dir);
  }
  return null;
}

export async function buildServer(): Promise<BuildResult> {
  const config = loadConfig();
  const app = Fastify({
    logger: {
      level: process.env.NODE_ENV === "test" ? "silent" : "info",
    },
  });

  const db = openDb(config.dbPath);

  let watcher: WatcherHandle | null = null;
  if (config.watchDir !== "") {
    watcher = startWatcher(config.watchDir, db, {
      log: (msg) => app.log.info(msg),
    });
  }

  app.addHook("onClose", async () => {
    watcher?.close();
    db.close();
  });

  await app.register(sensible);
  registerAuth(app, config.authToken);

  app.get("/health", () => ({
    status: "ok",
    service: "polaris",
    version: "0.2.0",
  }));

  app.post("/v1/ingest", { config: { requireAuth: true } }, async (request, reply) => {
    const parsed = IngestBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues });
    }
    const result = ingest(db, parsed.data.sessionFile, parsed.data.content);
    return reply.send(result);
  });

  app.get("/v1/metrics", { config: { requireAuth: true } }, async (request, reply) => {
    const query = request.query as { range?: string };
    const parsed = RangeSchema.safeParse(query.range);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid range. Allowed: today, 7d, 30d, all.",
      });
    }
    const range: TimeRange = parsed.data;
    const { fromMs, toMs } = resolveRange(range);
    const pricing = loadPricing();
    return reply.send(aggregate(db, range, fromMs, toMs, pricing));
  });

  // ACP reachability probe. Spawns claude-agent-acp, performs the JSON-RPC
  // `initialize` handshake, and reports the agent's advertised capabilities.
  // Each request is single-shot: spawn → init → kill. Session lifecycle proper
  // lands in v0.4 (ADR-0010). 5s timeout on initialize handles the case where
  // the bundled binary is present but the underlying `claude` install is not.
  app.get("/v1/acp/health", { config: { requireAuth: true } }, async (_request, reply) => {
    let handle: AcpProcessHandle | null = null;
    try {
      handle = spawnAcpProcess({ binCmd: config.acpBin });
      const client = createAcpJsonRpcClient(handle.stdin, handle.stdout);
      const capabilities = await client.request(
        "initialize",
        { protocolVersion: 1, clientCapabilities: {} },
        { timeoutMs: 5000 },
      );
      client.close();
      return reply.send({ available: true, capabilities });
    } catch (err) {
      return reply.code(503).send({ available: false, error: String(err) });
    } finally {
      if (handle) await handle.close();
    }
  });

  // Static UI mounted at "/". Only registered when the build artifact exists;
  // tests that hit `/` directly (without running `npm run build:ui` first) get
  // a 404, which is the intentional signal that the UI build is missing.
  const uiRoot = findUiRoot();
  if (uiRoot !== null) {
    await app.register(staticPlugin, {
      root: uiRoot,
      prefix: "/",
      decorateReply: false,
    });
  }

  return { app, config, db };
}

async function main(): Promise<void> {
  const { app, config } = await buildServer();
  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

const invokedDirectly =
  process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (invokedDirectly) {
  void main();
}
