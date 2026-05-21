import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../server.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const uiArtifact = resolve(repoRoot, "dist", "ui", "index.html");
const uiBuilt = existsSync(uiArtifact);

function readBundledCss(): string {
  const html = readFileSync(uiArtifact, "utf-8");
  const inlineMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
  const inline = inlineMatch?.[1] ?? "";
  const externalDir = resolve(repoRoot, "dist", "ui", "_polaris");
  if (!existsSync(externalDir)) return inline;
  const cssFiles = readdirSync(externalDir).filter((f) => f.endsWith(".css"));
  return inline + cssFiles.map((f) => readFileSync(resolve(externalDir, f), "utf-8")).join("\n");
}

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

  it.runIf(uiBuilt)("GET / serves both Metrics and Sessions tabs", async () => {
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('data-tab="metrics"');
    expect(res.body).toContain('data-tab="sessions"');
    expect(res.body).toContain("New session");
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

  it.runIf(uiBuilt)(
    "CSS rules for JS-injected elements are global (no Astro scope attribute)",
    () => {
      // Regression for v0.6.0 visual bug: Astro scoped CSS used attribute
      // selectors like `.session-card[data-astro-cid-XXXX]`, which never
      // matched HTML injected at runtime by the inline <script>. The result
      // was unstyled cards and KPIs. The fix is `<style is:global>`.
      // Astro may inline OR externalize the CSS depending on size — read both.
      const css = readBundledCss();
      expect(css).toMatch(/\.session-card\s*\{/);
      expect(css).toMatch(/\.kpi\s*\{/);
      expect(css).not.toMatch(/\.session-card\[data-astro-cid-/);
      expect(css).not.toMatch(/\.kpi\[data-astro-cid-/);
    },
  );

  it.runIf(uiBuilt)(
    "v0.16.0 rich-rendering CSS classes are present (tool-call, code-block, inline-code, log-body.markdown)",
    () => {
      const css = readBundledCss();
      expect(css).toMatch(/\.tool-call\s*\{/);
      expect(css).toMatch(/\.code-block\s*\{/);
      expect(css).toMatch(/\.inline-code\s*\{/);
      expect(css).toMatch(/\.tool-status\.completed\b/);
      expect(css).toMatch(/\.log-body\.markdown\s*\{/);
    },
  );

  it.runIf(uiBuilt)(
    "v0.16.0 inline script contains the Markdown renderer + streaming handlers",
    async () => {
      const res = await app.inject({ method: "GET", url: "/" });
      expect(res.statusCode).toBe(200);
      // These three symbols must exist for the rich renderer to function.
      expect(res.body).toContain("renderMarkdown");
      expect(res.body).toContain("renderAssistantChunk");
      expect(res.body).toContain("renderToolCall");
    },
  );

  it.runIf(uiBuilt)(
    "v0.19.0 prompt textarea wires Enter/Shift+Enter/Ctrl+L/Esc + cwd history datalist",
    async () => {
      const res = await app.inject({ method: "GET", url: "/" });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('list="cwd-history"');
      expect(res.body).toContain('id="cwd-history"');
      expect(res.body).toContain("Enter to send");
      expect(res.body).toContain("Shift+Enter");
      expect(res.body).toContain("submitPromptFromTextarea");
      expect(res.body).toContain("autoResizeTextarea");
      expect(res.body).toContain("updateCwdHistory");
    },
  );
});
