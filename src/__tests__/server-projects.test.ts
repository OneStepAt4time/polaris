import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../server.js";

const TOKEN = "projects-test-token-9876";

describe("GET /v1/projects", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.POLARIS_AUTH_TOKEN = TOKEN;
    process.env.POLARIS_DB_PATH = ":memory:";
    process.env.POLARIS_WATCH_DIR = "";
    const built = await buildServer();
    app = built.app;
    await app.ready();

    const now = new Date().toISOString();
    const seedA = `{"timestamp":"${now}","type":"assistant","message":{"model":"claude-sonnet-4-5","usage":{"input_tokens":1000,"output_tokens":500}},"requestId":"req-a-1","uuid":"u-a-1"}`;
    const seedB = `{"timestamp":"${now}","type":"assistant","message":{"model":"claude-opus-4-6-20260101","usage":{"input_tokens":2000,"output_tokens":1000}},"requestId":"req-b-1","uuid":"u-b-1"}`;
    await app.inject({
      method: "POST",
      url: "/v1/ingest",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { sessionFile: "/u/.claude/projects/proj-A/s1.jsonl", content: seedA },
    });
    await app.inject({
      method: "POST",
      url: "/v1/ingest",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { sessionFile: "/u/.claude/projects/proj-B/s2.jsonl", content: seedB },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns 401 without Authorization header", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/projects" });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 when days is non-numeric or non-positive", async () => {
    const bad = await app.inject({
      method: "GET",
      url: "/v1/projects?days=banana",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(bad.statusCode).toBe(400);
    const neg = await app.inject({
      method: "GET",
      url: "/v1/projects?days=-1",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(neg.statusCode).toBe(400);
  });

  it("groups events by project and returns dailyCostUsd of the requested length", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/projects?days=14",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      days: number;
      projects: { name: string; dailyCostUsd: number[]; costUsd: number }[];
    };
    expect(body.days).toBe(14);
    expect(body.projects.map((p) => p.name).sort()).toEqual(["proj-A", "proj-B"]);
    for (const proj of body.projects) {
      expect(proj.dailyCostUsd).toHaveLength(14);
      expect(proj.costUsd).toBeGreaterThan(0);
    }
  });

  it("defaults days to 30 when query param is omitted", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/projects",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { days: number };
    expect(body.days).toBe(30);
  });
});
