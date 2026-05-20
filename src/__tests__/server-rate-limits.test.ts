import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb } from "../db.js";
import { buildServer } from "../server.js";

const TOKEN = "rate-limits-test-token-9876";

describe("GET /v1/rate-limits (empty DB)", () => {
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
    const res = await app.inject({ method: "GET", url: "/v1/rate-limits" });
    expect(res.statusCode).toBe(401);
  });

  it("returns 503 when no sample exists, with a 'configured' boolean", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/rate-limits",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.statusCode).toBe(503);
    const body = res.json() as { error: string; configured: boolean };
    expect(body.error).toMatch(/no rate-limit sample/);
    expect(typeof body.configured).toBe("boolean");
  });
});

describe("GET /v1/rate-limits (with sample)", () => {
  let app: FastifyInstance;
  let tmpDir: string;
  let dbPath: string;

  beforeAll(async () => {
    tmpDir = mkdtempSync(resolve(tmpdir(), "polaris-rate-"));
    dbPath = resolve(tmpDir, "polaris.db");
    // Pre-seed a sample using a one-shot openDb on the same file path. The
    // server below opens the same file and reads back the row.
    const seedDb = openDb(dbPath);
    seedDb.insertRateLimitSample({
      tsMs: 1_700_000_000_000,
      httpStatus: 200,
      rawJson: '{"five_hour":{"utilization":0.42},"seven_day":{"utilization":0.10}}',
      error: null,
    });
    seedDb.close();

    process.env.POLARIS_AUTH_TOKEN = TOKEN;
    process.env.POLARIS_DB_PATH = dbPath;
    process.env.POLARIS_WATCH_DIR = "";
    const built = await buildServer();
    app = built.app;
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns 200 with the parsed payload extracted from rawJson", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/rate-limits",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      tsMs: number;
      httpStatus: number;
      error: string | null;
      payload: { five_hour?: { utilization: number } };
    };
    expect(body.tsMs).toBe(1_700_000_000_000);
    expect(body.httpStatus).toBe(200);
    expect(body.error).toBeNull();
    expect(body.payload?.five_hour?.utilization).toBe(0.42);
  });
});
