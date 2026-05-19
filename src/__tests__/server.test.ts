import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../server.js";

describe("server", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.POLARIS_AUTH_TOKEN = "test-token-1234";
    process.env.POLARIS_DB_PATH = ":memory:";
    const built = await buildServer();
    app = built.app;
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /health returns 200 with service info", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      status: "ok",
      service: "polaris",
      version: "0.4.0",
    });
  });

  it("GET /unknown returns 404", async () => {
    const res = await app.inject({ method: "GET", url: "/unknown" });
    expect(res.statusCode).toBe(404);
  });
});

describe("config", () => {
  it("rejects missing POLARIS_AUTH_TOKEN", async () => {
    const { loadConfig } = await import("../config.js");
    expect(() => loadConfig({ POLARIS_AUTH_TOKEN: undefined } as NodeJS.ProcessEnv)).toThrow(
      /authToken/,
    );
  });

  it("rejects short POLARIS_AUTH_TOKEN", async () => {
    const { loadConfig } = await import("../config.js");
    expect(() => loadConfig({ POLARIS_AUTH_TOKEN: "short" } as NodeJS.ProcessEnv)).toThrow(
      /at least 8 chars/,
    );
  });

  it("applies defaults for host and port", async () => {
    const { loadConfig } = await import("../config.js");
    const cfg = loadConfig({ POLARIS_AUTH_TOKEN: "test-token-1234" } as NodeJS.ProcessEnv);
    expect(cfg.host).toBe("127.0.0.1");
    expect(cfg.port).toBe(3000);
  });
});
