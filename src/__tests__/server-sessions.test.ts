import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../server.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(here, "fixtures", "acp-mock-server.mjs");
const TOKEN = "sessions-test-token-9999";

describe("session lifecycle routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.POLARIS_AUTH_TOKEN = TOKEN;
    process.env.POLARIS_DB_PATH = ":memory:";
    process.env.POLARIS_WATCH_DIR = "";
    process.env.POLARIS_ACP_BIN = `"${process.execPath}" "${fixturePath}"`;
    const built = await buildServer();
    app = built.app;
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("POST /v1/sessions without auth returns 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/sessions",
      payload: { cwd: "/tmp" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("POST /v1/sessions with valid body returns 201 and the record", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/sessions",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { cwd: "/tmp/proj-a" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { id: string; cwd: string; status: string };
    expect(body.cwd).toBe("/tmp/proj-a");
    expect(body.status).toBe("idle");
    expect(body.id).toMatch(/^fixture-session-\d+$/);
  });

  it("POST /v1/sessions with invalid body returns 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/sessions",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { notCwd: 42 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET /v1/sessions/:id returns the record", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/sessions",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { cwd: "/tmp/proj-b" },
    });
    const id = (created.json() as { id: string }).id;
    const res = await app.inject({
      method: "GET",
      url: `/v1/sessions/${id}`,
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { cwd: string }).cwd).toBe("/tmp/proj-b");
  });

  it("GET /v1/sessions/:id returns 404 for unknown ids", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/sessions/nope-not-a-session",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("POST /v1/sessions/:id/messages returns prompt result", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/sessions",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { cwd: "/tmp/proj-c" },
    });
    const id = (created.json() as { id: string }).id;
    const res = await app.inject({
      method: "POST",
      url: `/v1/sessions/${id}/messages`,
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { text: "ciao" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { stopReason: string; updates: unknown[] };
    expect(body.stopReason).toBe("end_turn");
    expect(body.updates).toHaveLength(2);
  });

  it("POST /v1/sessions/:id/messages returns 404 for unknown id", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/sessions/nope/messages",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { text: "ciao" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("DELETE /v1/sessions/:id removes the record", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/sessions",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { cwd: "/tmp/proj-d" },
    });
    const id = (created.json() as { id: string }).id;
    const del = await app.inject({
      method: "DELETE",
      url: `/v1/sessions/${id}`,
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(del.statusCode).toBe(204);
    const after = await app.inject({
      method: "GET",
      url: `/v1/sessions/${id}`,
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(after.statusCode).toBe(404);
  });

  it("GET /v1/sessions returns the active set", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/sessions",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { sessions: Array<{ id: string }> };
    expect(Array.isArray(body.sessions)).toBe(true);
  });
});
