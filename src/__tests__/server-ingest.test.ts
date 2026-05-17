import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../server.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string =>
  readFileSync(resolve(here, "fixtures", "jsonl", name), "utf8");

const TOKEN = "ingest-test-token-9876";

describe("POST /v1/ingest", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.POLARIS_AUTH_TOKEN = TOKEN;
    process.env.POLARIS_DB_PATH = ":memory:";
    const built = await buildServer();
    app = built.app;
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns 401 without Authorization header", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/ingest",
      payload: { sessionFile: "x", content: "" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 401 with wrong token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/ingest",
      headers: { authorization: "Bearer wrong-token" },
      payload: { sessionFile: "x", content: "" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 with malformed body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/ingest",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { content: "missing sessionFile" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 200 + counts when authorized with valid JSONL", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/ingest",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: {
        sessionFile: "test-session",
        content: fixture("single-session.jsonl"),
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      parsed: number;
      inserted: number;
      duplicatesInBatch: number;
    };
    expect(body.parsed).toBe(3);
    expect(body.inserted).toBe(3);
    expect(body.duplicatesInBatch).toBe(0);
  });

  it("GET /health remains unauthenticated", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
  });
});
