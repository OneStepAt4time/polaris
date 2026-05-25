import { existsSync, readFileSync } from "node:fs";
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
import type { Channel } from "./channels/channel.js";
import { makeDiscordChannel } from "./channels/discord.js";
import { makeSlackChannel } from "./channels/slack.js";
import { makeTelegramChannel } from "./channels/telegram.js";
import { makeWebhookChannel } from "./channels/webhook.js";
import { type Config, loadConfig, parseTelegramEnv } from "./config.js";
import { type PolarisDb, openDb } from "./db.js";
import { ingest } from "./ingest/ingest.js";
import { type WatcherHandle, startWatcher } from "./ingest/jsonl-watcher.js";
import {
  type TimeRange,
  aggregate,
  resolvePreviousRange,
  resolveRange,
} from "./metrics/aggregator.js";
import { aggregateHeatmap, isHeatmapMetric } from "./metrics/heatmap.js";
import { loadPricing } from "./metrics/pricing.js";
import { aggregateByProject } from "./metrics/projects.js";
import { loadOAuthCredentials } from "./rate-limit/oauth.js";
import { type PollerHandle, startRateLimitPoller } from "./rate-limit/poller.js";
import { extractToolName } from "./rules/approval-needed.js";
import { type EngineHandle, startEngine } from "./rules/engine.js";

// v0.26.2: read version from package.json once at module load so /health
// can never drift from package.json again (previous hardcoded string
// stayed at "0.26.0" through the v0.26.1 release).
const POLARIS_VERSION: string = (() => {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // dist/server.js → ../package.json. src/server.ts (tests/dev) → ../package.json.
    const pkg = JSON.parse(readFileSync(resolve(here, "..", "package.json"), "utf8")) as {
      version?: string;
    };
    return typeof pkg.version === "string" ? pkg.version : "unknown";
  } catch {
    return "unknown";
  }
})();

const IngestBodySchema = z.object({
  sessionFile: z.string().min(1),
  content: z.string(),
});

const RangeSchema = z.enum(["1h", "12h", "today", "7d", "30d", "all"]).default("today");

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
      sessionManager = createSessionManager({ binCmd: config.acpBin, store: db });
    }
    return sessionManager;
  };

  // Rules engine: started only when at least one rule has a non-zero
  // threshold AND at least one notification channel is configured. Polls
  // every 5 min and deduplicates via the notifications_sent table.
  let rulesEngine: EngineHandle | null = null;
  const channels: Channel[] = [];
  const tg = parseTelegramEnv(config.telegram);
  if (tg !== null) {
    channels.push(makeTelegramChannel({ botToken: tg.botToken, chatId: tg.chatId }));
  }
  if (config.slackWebhookUrl !== "") {
    channels.push(makeSlackChannel({ webhookUrl: config.slackWebhookUrl }));
  }
  if (config.discordWebhookUrl !== "") {
    channels.push(makeDiscordChannel({ webhookUrl: config.discordWebhookUrl }));
  }
  if (config.webhookUrl !== "") {
    channels.push(makeWebhookChannel({ url: config.webhookUrl }));
  }
  const hasAnyRule = config.dailyCostThresholdUsd > 0 || config.rateLimitNearThresholdPct > 0;
  if (channels.length > 0 && hasAnyRule) {
    rulesEngine = startEngine(
      db,
      loadPricing(),
      {
        costThreshold:
          config.dailyCostThresholdUsd > 0 ? { thresholdUsd: config.dailyCostThresholdUsd } : null,
        rateLimitNear:
          config.rateLimitNearThresholdPct > 0
            ? { thresholdPct: config.rateLimitNearThresholdPct }
            : null,
        // why: daily summary is automatically enabled when any threshold
        //       rule is configured + at least one channel is wired. Fires
        //       once per UTC day at hour 23. No new env var — opt-in via
        //       the same conditions that start the rules engine. v0.14.0.
        dailySummary: { hourUtc: 23 },
        // why: session-failed reads the SessionManager's in-memory failure
        //       buffer. The SessionManager is lazy-init, so the getter
        //       returns [] until the manager has been spawned. v0.15.0.
        sessionFailed: {
          failuresSource: () => sessionManager?.recentFailures() ?? [],
        },
        // v0.27.0: fire when any active session is waiting for a tool-
        // permission approval. Each distinct approvalId is notified once;
        // once the user approves/denies the approval disappears and the
        // rule goes quiet. Enabled whenever channels are wired (same
        // condition as the engine itself — no new env var).
        approvalNeeded: {
          approvalsSource: () => {
            const mgr = sessionManager;
            if (!mgr) return [];
            return mgr
              .listSessions()
              .filter((s) => (s.pendingApprovalsCount ?? 0) > 0)
              .flatMap((s) =>
                mgr.listApprovals(s.id).map((a) => ({
                  sessionId: s.id,
                  cwd: s.cwd,
                  approvalId: a.approvalId,
                  receivedAt: a.receivedAt,
                  toolName: extractToolName(a.params),
                })),
              );
          },
        },
        channels,
        intervalMs: 5 * 60 * 1000,
      },
      (msg) => app.log.info(msg),
    );
  }

  // Rate-limit poller: started only when ~/.claude/.credentials.json is readable.
  // Without OAuth credentials, /v1/rate-limits returns 503 and the UI section
  // shows a "not configured" message. v0.9.0.
  let ratePoller: PollerHandle | null = null;
  const credentials = loadOAuthCredentials();
  if (credentials !== null) {
    ratePoller = startRateLimitPoller(db, { credentials }, (msg) => app.log.info(msg));
  }

  app.addHook("onClose", async () => {
    ratePoller?.stop();
    rulesEngine?.stop();
    watcher?.close();
    if (sessionManager) await sessionManager.close();
    db.close();
  });

  await app.register(sensible);
  registerAuth(app, config.authToken);

  app.get("/health", () => ({
    status: "ok",
    service: "polaris",
    version: POLARIS_VERSION,
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
        error: "Invalid range. Allowed: 1h, 12h, today, 7d, 30d, all.",
      });
    }
    const range: TimeRange = parsed.data;
    const { fromMs, toMs } = resolveRange(range);
    const pricing = loadPricing();
    const result = aggregate(db, range, fromMs, toMs, pricing);
    // v0.25.0: also compute the previous-period block so the UI can render
    // % deltas on each KPI tile. Skipped for `range=all` where there's no
    // meaningful predecessor.
    const prevRange = resolvePreviousRange(range);
    if (prevRange !== null) {
      const prev = aggregate(db, range, prevRange.fromMs, prevRange.toMs, pricing);
      result.previous = {
        fromMs: prevRange.fromMs,
        toMs: prevRange.toMs,
        totals: prev.totals,
      };
    }
    return reply.send(result);
  });

  app.get("/v1/projects", { config: { requireAuth: true } }, async (request, reply) => {
    const query = request.query as { days?: string };
    const daysRaw = query.days !== undefined ? Number(query.days) : 30;
    if (!Number.isFinite(daysRaw) || daysRaw <= 0) {
      return reply.code(400).send({ error: "Invalid days. Must be a positive integer." });
    }
    const pricing = loadPricing();
    return reply.send(aggregateByProject(db, pricing, daysRaw));
  });

  app.get("/v1/heatmap", { config: { requireAuth: true } }, async (request, reply) => {
    const query = request.query as { days?: string; metric?: string };
    const daysRaw = query.days !== undefined ? Number(query.days) : 180;
    if (!Number.isFinite(daysRaw) || daysRaw <= 0) {
      return reply.code(400).send({ error: "Invalid days. Must be a positive integer." });
    }
    const metricRaw = query.metric ?? "cost";
    if (!isHeatmapMetric(metricRaw)) {
      return reply.code(400).send({
        error: "Invalid metric. Allowed: cost, events, outputTokens, sessions.",
      });
    }
    const pricing = loadPricing();
    return reply.send(aggregateHeatmap(db, pricing, metricRaw, daysRaw));
  });

  app.get("/v1/rate-limits", { config: { requireAuth: true } }, async (_request, reply) => {
    const sample = db.getLatestRateLimitSample();
    if (sample === null) {
      return reply.code(503).send({
        error: "no rate-limit sample yet",
        configured: ratePoller !== null,
      });
    }
    let parsed: unknown = null;
    if (sample.rawJson !== null) {
      try {
        parsed = JSON.parse(sample.rawJson);
      } catch {
        parsed = null;
      }
    }
    return reply.send({
      tsMs: sample.tsMs,
      httpStatus: sample.httpStatus,
      error: sample.error,
      payload: parsed,
    });
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
    // Merge in-memory sessions (authoritative for live status) with persisted
    // history (authoritative for ended sessions). In-memory wins on dup id.
    const live = sessionManager ? sessionManager.listSessions() : [];
    const liveIds = new Set(live.map((s) => s.id));
    const persisted = db.listAcpSessions().filter((row) => !liveIds.has(row.id));
    const history = persisted.map((row) => {
      const session: Record<string, unknown> = {
        id: row.id,
        cwd: row.cwd,
        createdAt: row.createdAt,
        lastActivityAt: row.lastActivityAt,
        status: row.status,
        updates: [],
        endedAt: row.endedAt,
        endReason: row.endReason,
      };
      if (row.settingsJson !== null) {
        try {
          session.settings = JSON.parse(row.settingsJson);
        } catch {
          // ignore corrupt settings json
        }
      }
      return session;
    });
    return reply.send({ sessions: [...live, ...history] });
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

  app.get<{ Params: { id: string } }>(
    "/v1/sessions/:id/transcript",
    { config: { requireAuth: true } },
    async (request, reply) => {
      const id = request.params.id;
      const row = db.getAcpSession(id);
      if (row === null) return reply.code(404).send({ error: "Session not found" });
      const messages = db.getSessionMessages(id).map((m) => {
        let payload: unknown = m.payloadJson;
        try {
          payload = JSON.parse(m.payloadJson);
        } catch {
          // keep raw string when payload is non-JSON
        }
        return { tsMs: m.tsMs, kind: m.kind, payload };
      });
      return reply.send({
        sessionId: row.id,
        cwd: row.cwd,
        createdAt: row.createdAt,
        lastActivityAt: row.lastActivityAt,
        status: row.status,
        endedAt: row.endedAt,
        endReason: row.endReason,
        messages,
      });
    },
  );

  app.post<{ Params: { id: string } }>(
    "/v1/sessions/:id/resume",
    { config: { requireAuth: true } },
    async (request, reply) => {
      const id = request.params.id;
      const row = db.getAcpSession(id);
      if (row === null) return reply.code(404).send({ error: "Session not found" });
      try {
        const rec = await getSessionManager().loadSession(id, { cwd: row.cwd });
        return reply.send(rec);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        // claude-agent-acp returns -32601 / -32602 when session/load is
        // unsupported or the session isn't recoverable. Surface as 422 so
        // the UI can distinguish from a 5xx transport failure.
        return reply.code(422).send({
          error: "Session could not be resumed",
          detail: message,
        });
      }
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
