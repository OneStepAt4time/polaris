import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../server.js";

const TOKEN = "metrics-test-token-9876";

describe("GET /v1/metrics", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.POLARIS_AUTH_TOKEN = TOKEN;
    process.env.POLARIS_DB_PATH = ":memory:";
    process.env.POLARIS_WATCH_DIR = "";
    const built = await buildServer();
    app = built.app;
    await app.ready();

    // Seed via the ingest endpoint so the metrics tests don't depend on db.ts internals.
    const seedContent = [
      `{"timestamp":"${new Date().toISOString()}","type":"assistant","message":{"model":"claude-sonnet-4-5","usage":{"input_tokens":1000,"output_tokens":500}},"requestId":"req_seed_1","uuid":"u-seed-1"}`,
      `{"timestamp":"${new Date().toISOString()}","type":"assistant","message":{"model":"claude-opus-4-6-20260101","usage":{"input_tokens":2000,"output_tokens":1000}},"requestId":"req_seed_2","uuid":"u-seed-2"}`,
    ].join("\n");
    await app.inject({
      method: "POST",
      url: "/v1/ingest",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { sessionFile: "metrics-seed", content: seedContent },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns 401 without Authorization header", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/metrics" });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 for unknown range", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/metrics?range=yesterday",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns metrics with default 'today' when range omitted", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/metrics",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      range: string;
      totals: { events: number; costUsd: number };
      perModel: { model: string; costUsd: number }[];
    };
    expect(body.range).toBe("today");
    expect(body.totals.events).toBe(2);
    expect(body.perModel).toHaveLength(2);
    expect(body.totals.costUsd).toBeGreaterThan(0);
  });

  it("returns metrics for 'all' range including all seeded events", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/metrics?range=all",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      range: string;
      totals: { events: number };
      perModel: { model: string }[];
    };
    expect(body.range).toBe("all");
    expect(body.totals.events).toBe(2);
    const models = body.perModel.map((m) => m.model).sort();
    expect(models).toEqual(["claude-opus-4-6-20260101", "claude-sonnet-4-5"]);
  });

  it("returns full result shape: range, fromMs, toMs, totals, perModel", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/metrics?range=7d",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    const body = res.json() as Record<string, unknown>;
    expect(body).toHaveProperty("range", "7d");
    expect(body).toHaveProperty("fromMs");
    expect(body).toHaveProperty("toMs");
    expect(body).toHaveProperty("totals");
    expect(body).toHaveProperty("perModel");
  });

  it("v0.25.0: includes a 'previous' block for finite ranges", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/metrics?range=today",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      previous?: { fromMs: number; toMs: number; totals: { events: number } };
    };
    expect(body.previous).toBeDefined();
    expect(body.previous?.fromMs).toBeGreaterThan(0);
    expect(body.previous?.toMs).toBeGreaterThan(body.previous?.fromMs ?? 0);
    expect(body.previous?.totals).toHaveProperty("events");
  });

  it("v0.25.0: omits 'previous' for range=all (no predecessor)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/metrics?range=all",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { previous?: unknown };
    expect(body.previous).toBeUndefined();
  });
});
