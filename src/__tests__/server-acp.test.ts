import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../server.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(here, "fixtures", "acp-mock-server.mjs");

const TOKEN = "acp-health-token-1234";

describe("GET /v1/acp/health", () => {
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

  it("returns 401 without auth", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/acp/health" });
    expect(res.statusCode).toBe(401);
  });

  it("returns 200 + capabilities when the fixture replies to initialize", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/acp/health",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      available: boolean;
      capabilities: { protocolVersion: number };
    };
    expect(body.available).toBe(true);
    expect(body.capabilities.protocolVersion).toBe(1);
  });

  it("returns 503 when the binary path is bogus", async () => {
    // Override config via env for this test: a clearly missing binary.
    // We rebuild server with the new env to pick it up.
    process.env.POLARIS_ACP_BIN = "this-binary-definitely-does-not-exist-xyzqwerty";
    const tempBuilt = await buildServer();
    try {
      const res = await tempBuilt.app.inject({
        method: "GET",
        url: "/v1/acp/health",
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      expect(res.statusCode).toBe(503);
      const body = res.json() as { available: boolean };
      expect(body.available).toBe(false);
    } finally {
      await tempBuilt.app.close();
      // Restore for any later tests
      process.env.POLARIS_ACP_BIN = `"${process.execPath}" "${fixturePath}"`;
    }
  });
});
