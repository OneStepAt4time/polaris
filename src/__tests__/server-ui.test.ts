import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../server.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const uiArtifact = resolve(repoRoot, "dist", "ui", "index.html");
const uiBuilt = existsSync(uiArtifact);

describe("static UI mount", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.POLARIS_AUTH_TOKEN = "ui-test-token-9876";
    process.env.POLARIS_DB_PATH = ":memory:";
    process.env.POLARIS_WATCH_DIR = "";
    const built = await buildServer();
    app = built.app;
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it.runIf(uiBuilt)("GET / returns HTML when UI was built", async () => {
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.body).toContain("<!DOCTYPE html>");
    expect(res.body.toLowerCase()).toContain("polaris");
  });

  it.runIf(uiBuilt)("GET / does NOT require auth (static shell is public)", async () => {
    // Note: the dynamic /v1/* endpoints stay auth-gated. The HTML shell is
    // public so users can hit the page to enter their token.
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
  });

  it.runIf(!uiBuilt)(
    "GET / returns 404 when dist/ui has not been built (npm run build:ui not run)",
    async () => {
      const res = await app.inject({ method: "GET", url: "/" });
      expect(res.statusCode).toBe(404);
    },
  );

  it("GET /v1/metrics still requires auth even with UI mounted", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/metrics" });
    expect(res.statusCode).toBe(401);
  });

  it("GET /health still works (unauthenticated, JSON, not eaten by static)", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
  });
});
