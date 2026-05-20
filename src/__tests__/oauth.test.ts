import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadOAuthCredentials } from "../rate-limit/oauth.js";

describe("loadOAuthCredentials", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(resolve(tmpdir(), "polaris-oauth-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function write(contents: string): string {
    const path = resolve(tmp, ".credentials.json");
    writeFileSync(path, contents);
    return path;
  }

  it("returns null when the file is missing", () => {
    expect(loadOAuthCredentials(resolve(tmp, "does-not-exist.json"))).toBeNull();
  });

  it("returns null when the file is not valid JSON", () => {
    const path = write("not json");
    expect(loadOAuthCredentials(path)).toBeNull();
  });

  it("returns null when claudeAiOauth.accessToken is missing", () => {
    const path = write(JSON.stringify({ claudeAiOauth: { refreshToken: "abc" } }));
    expect(loadOAuthCredentials(path)).toBeNull();
  });

  it("returns null when claudeAiOauth is not an object", () => {
    const path = write(JSON.stringify({ claudeAiOauth: "string" }));
    expect(loadOAuthCredentials(path)).toBeNull();
  });

  it("returns the accessToken when present, plus optional fields", () => {
    const path = write(
      JSON.stringify({
        claudeAiOauth: {
          accessToken: "sk-ant-oat-x",
          refreshToken: "sk-ant-ort-y",
          expiresAt: "2026-06-01T12:00:00Z",
          subscriptionType: "max",
        },
      }),
    );
    const creds = loadOAuthCredentials(path);
    expect(creds).not.toBeNull();
    expect(creds?.accessToken).toBe("sk-ant-oat-x");
    expect(creds?.refreshToken).toBe("sk-ant-ort-y");
    expect(creds?.subscriptionType).toBe("max");
    expect(creds?.expiresAtMs).toBe(Date.parse("2026-06-01T12:00:00Z"));
  });

  it("handles expiresAt as a number (epoch ms) as well as ISO string", () => {
    const path = write(
      JSON.stringify({ claudeAiOauth: { accessToken: "x", expiresAt: 1779000000000 } }),
    );
    expect(loadOAuthCredentials(path)?.expiresAtMs).toBe(1779000000000);
  });
});
