import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../server.js";

const TOKEN = "heatmap-test-token-9876";

describe("GET /v1/heatmap", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.POLARIS_AUTH_TOKEN = TOKEN;
    process.env.POLARIS_DB_PATH = ":memory:";
    process.env.POLARIS_WATCH_DIR = "";
    const built = await buildServer();
    app = built.app;
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns 401 without Authorization header", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/heatmap" });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 when days is non-numeric or non-positive", async () => {
    const bad = await app.inject({
      method: "GET",
      url: "/v1/heatmap?days=banana",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(bad.statusCode).toBe(400);
    const neg = await app.inject({
      method: "GET",
      url: "/v1/heatmap?days=-1",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(neg.statusCode).toBe(400);
  });

  it("returns 400 when metric is unknown", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/heatmap?metric=foo",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("defaults days=180 and metric=cost when omitted", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/heatmap",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      days: number;
      metric: string;
      dailyValues: number[];
      firstDayOfWeekUtc: number;
    };
    expect(body.days).toBe(180);
    expect(body.metric).toBe("cost");
    expect(body.dailyValues).toHaveLength(180);
    expect(body.firstDayOfWeekUtc).toBeGreaterThanOrEqual(0);
    expect(body.firstDayOfWeekUtc).toBeLessThanOrEqual(6);
  });

  it("accepts all four metrics: cost, events, outputTokens, sessions", async () => {
    for (const metric of ["cost", "events", "outputTokens", "sessions"]) {
      const res = await app.inject({
        method: "GET",
        url: `/v1/heatmap?days=7&metric=${metric}`,
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      expect(res.statusCode, `metric=${metric}`).toBe(200);
      const body = res.json() as { metric: string; days: number };
      expect(body.metric).toBe(metric);
      expect(body.days).toBe(7);
    }
  });
});
