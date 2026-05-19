import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sensible from "@fastify/sensible";
import staticPlugin from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import { createAcpJsonRpcClient } from "./acp/json-rpc-client.js";
import { type SessionManager, createSessionManager } from "./acp/session-manager.js";
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

const CreateSessionBodySchema = z.object({
  cwd: z.string().min(1),
  mcpServers: z.array(z.unknown()).optional(),
});

const PromptBodySchema = z.object({
  text: z.string().min(1),
  timeoutMs: z.number().int().positive().optional(),
});

const ApprovalBodySchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("selected"), optionId: z.string().min(1) }),
  z.object({ outcome: z.literal("cancelled") }),
]);

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
    // why: long-running Claude Code sessions produce JSONL files that grow
    //       past Fastify's 1 MB default (a single 24/7 agent run can hit
    //       70 MB+). Backfill + watcher re-parse need to ingest a whole
    //       file in one POST. 128 MB ceiling caps pathological inputs.
    bodyLimit: 128 * 1024 * 1024,
  });

  const db = openDb(config.dbPath);

  let watcher: WatcherHandle | null = null;
  if (config.watchDir !== "") {
    watcher = startWatcher(config.watchDir, db, {
      log: (msg) => app.log.info(msg),
    });
  }

  // Session manager singleton. Spawned on first /v1/sessions* request so the
  // ACP child process is not paid for by callers who only use /v1/metrics or
  // /v1/ingest. Closed alongside the server.
  let sessionManager: SessionManager | null = null;
  const getSessionManager = (): SessionManager => {
    if (sessionManager === null) {
      sessionManager = createSessionManager({ binCmd: config.acpBin });
    }
    return sessionManager;
  };

  app.addHook("onClose", async () => {
    watcher?.close();
    if (sessionManager) await sessionManager.close();
    db.close();
  });

  await app.register(sensible);
  registerAuth(app, config.authToken);

  app.get("/health", () => ({
    status: "ok",
    service: "polaris",
    version: "0.5.0",
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

  // Session lifecycle (ADR-0010 control plane). The routes mirror the ACP
  // session methods (session/new, session/prompt, session/cancel) and expose a
  // registry of in-flight sessions. ACP-C adds the SSE event stream + approval
  // response surface so server-initiated session/request_permission requests
  // round-trip back to the caller.
  app.post("/v1/sessions", { config: { requireAuth: true } }, async (request, reply) => {
    const parsed = CreateSessionBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues });
    }
    try {
      const created = await getSessionManager().createSession({
        cwd: parsed.data.cwd,
        ...(parsed.data.mcpServers !== undefined && { mcpServers: parsed.data.mcpServers }),
      });
      return reply.code(201).send(created);
    } catch (err) {
      return reply.code(503).send({ error: String(err) });
    }
  });

  app.get("/v1/sessions", { config: { requireAuth: true } }, async (_request, reply) => {
    const sessions = sessionManager ? sessionManager.listSessions() : [];
    return reply.send({ sessions });
  });

  app.get<{ Params: { id: string } }>(
    "/v1/sessions/:id",
    { config: { requireAuth: true } },
    async (request, reply) => {
      const rec = sessionManager?.getSession(request.params.id);
      if (!rec) return reply.code(404).send({ error: "Session not found" });
      return reply.send(rec);
    },
  );

  app.post<{ Params: { id: string } }>(
    "/v1/sessions/:id/messages",
    { config: { requireAuth: true } },
    async (request, reply) => {
      const parsed = PromptBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues });
      }
      if (!sessionManager?.getSession(request.params.id)) {
        return reply.code(404).send({ error: "Session not found" });
      }
      try {
        const result = await sessionManager.sendPrompt(
          request.params.id,
          parsed.data.text,
          parsed.data.timeoutMs,
        );
        return reply.send(result);
      } catch (err) {
        return reply.code(503).send({ error: String(err) });
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/v1/sessions/:id",
    { config: { requireAuth: true } },
    async (request, reply) => {
      if (!sessionManager?.getSession(request.params.id)) {
        return reply.code(404).send({ error: "Session not found" });
      }
      await sessionManager.deleteSession(request.params.id);
      return reply.code(204).send();
    },
  );

  // SSE event stream. The handler hijacks the response and pumps each
  // SessionEvent as a single `data: <json>\n\n` frame. Closing the request
  // (client disconnect, or DELETE on the session) unsubscribes the listener.
  app.get<{ Params: { id: string } }>(
    "/v1/sessions/:id/events",
    { config: { requireAuth: true } },
    async (request, reply) => {
      const mgr = sessionManager;
      if (!mgr?.getSession(request.params.id)) {
        return reply.code(404).send({ error: "Session not found" });
      }
      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      raw.write(": subscribed\n\n");
      const unsubscribe = mgr.subscribe(request.params.id, (event) => {
        raw.write(`data: ${JSON.stringify(event)}\n\n`);
        if (event.type === "session-closed") raw.end();
      });
      request.raw.once("close", () => unsubscribe());
    },
  );

  app.get<{ Params: { id: string } }>(
    "/v1/sessions/:id/approvals",
    { config: { requireAuth: true } },
    async (request, reply) => {
      const mgr = sessionManager;
      if (!mgr?.getSession(request.params.id)) {
        return reply.code(404).send({ error: "Session not found" });
      }
      return reply.send({ approvals: mgr.listApprovals(request.params.id) });
    },
  );

  app.post<{ Params: { id: string; approvalId: string } }>(
    "/v1/sessions/:id/approvals/:approvalId",
    { config: { requireAuth: true } },
    async (request, reply) => {
      const mgr = sessionManager;
      if (!mgr?.getSession(request.params.id)) {
        return reply.code(404).send({ error: "Session not found" });
      }
      const parsed = ApprovalBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues });
      }
      const ok = mgr.respondToApproval(request.params.id, request.params.approvalId, parsed.data);
      if (!ok) return reply.code(404).send({ error: "Approval not found" });
      return reply.code(204).send();
    },
  );

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
