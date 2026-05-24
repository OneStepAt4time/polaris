import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb } from "../db.js";
import { buildServer } from "../server.js";

const TOKEN = "transcript-test-token-9876";

describe("GET /v1/sessions/:id/transcript", () => {
  let app: FastifyInstance;
  let tmp: string;
  let dbPath: string;

  beforeAll(async () => {
    tmp = mkdtempSync(resolve(tmpdir(), "polaris-trans-"));
    dbPath = resolve(tmp, "polaris.db");
    // Seed an ended session + a few messages using a one-shot DB handle.
    const seed = openDb(dbPath);
    seed.upsertAcpSession({
      id: "ended-1",
      cwd: "/tmp/x",
      createdAt: 1_000_000,
      lastActivityAt: 1_000_500,
      status: "idle",
      endedAt: null,
      endReason: null,
      settingsJson: JSON.stringify({ claudeMdDetected: true }),
    });
    seed.appendSessionMessage({
      sessionId: "ended-1",
      tsMs: 1_000_100,
      kind: "agent_message",
      payloadJson: JSON.stringify({ params: { kind: "agent_message", text: "hi" } }),
    });
    seed.appendSessionMessage({
      sessionId: "ended-1",
      tsMs: 1_000_200,
      kind: "tool_call",
      payloadJson: JSON.stringify({ params: { kind: "tool_call", title: "Bash" } }),
    });
    seed.closeAcpSession("ended-1", 1_000_500, "deleted");
    seed.close();

    process.env.POLARIS_AUTH_TOKEN = TOKEN;
    process.env.POLARIS_DB_PATH = dbPath;
    process.env.POLARIS_WATCH_DIR = "";
    const built = await buildServer();
    app = built.app;
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/sessions/ended-1/transcript",
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 404 for unknown session id", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/sessions/nope/transcript",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns the persisted transcript with parsed payloads + endedAt/endReason", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/sessions/ended-1/transcript",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      sessionId: string;
      status: string;
      endedAt: number | null;
      endReason: string | null;
      messages: { tsMs: number; kind: string; payload: { params: { kind: string } } }[];
    };
    expect(body.sessionId).toBe("ended-1");
    expect(body.status).toBe("closed");
    expect(body.endedAt).toBe(1_000_500);
    expect(body.endReason).toBe("deleted");
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0]?.kind).toBe("agent_message");
    expect(body.messages[0]?.payload.params.kind).toBe("agent_message");
    expect(body.messages[1]?.kind).toBe("tool_call");
  });

  it("/v1/sessions returns ended sessions from the DB even when no live SessionManager", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/sessions",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { sessions: { id: string; status: string }[] };
    expect(body.sessions.some((s) => s.id === "ended-1" && s.status === "closed")).toBe(true);
  });

  it("POST /v1/sessions/:id/resume returns 404 for unknown id (v0.22.0)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/sessions/never-existed/resume",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.statusCode).toBe(404);
  });
});
