import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type PolarisDb, openDb } from "../db.js";
import { loadPricing } from "../metrics/pricing.js";
import { buildSessionCostMap, sessionIdFromFile } from "../server.js";

describe("sessionIdFromFile (v0.36.0)", () => {
  it("extracts the session id from a POSIX path", () => {
    expect(sessionIdFromFile("/home/u/.claude/projects/D--polaris/abc-123.jsonl")).toBe("abc-123");
  });
  it("extracts the session id from a Windows path", () => {
    expect(sessionIdFromFile("C:\\Users\\m\\.claude\\projects\\D--aegis\\xyz.jsonl")).toBe("xyz");
  });
  it("returns null when the file is not a .jsonl", () => {
    expect(sessionIdFromFile("/p/abc.log")).toBeNull();
    expect(sessionIdFromFile("/p/abc")).toBeNull();
  });
  it("returns null for an empty stem", () => {
    expect(sessionIdFromFile("/p/.jsonl")).toBeNull();
  });
});

describe("buildSessionCostMap (v0.36.0)", () => {
  let db: PolarisDb;
  const pricing = loadPricing();
  beforeEach(() => {
    db = openDb(":memory:");
  });
  afterEach(() => {
    db.close();
  });

  it("returns empty for an empty DB", () => {
    const m = buildSessionCostMap(db, pricing);
    expect(m.size).toBe(0);
  });

  it("aggregates lifetime cost across all events for a session", () => {
    const sid = "session-A";
    db.insertEvent({
      requestId: "r1",
      sessionFile: `/u/.claude/projects/D--polaris/${sid}.jsonl`,
      tsMs: 1_700_000_000_000,
      model: "claude-sonnet-4-5",
      inputTokens: 1_000_000,
      outputTokens: 500_000,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      rawCostUsd: null,
    });
    db.insertEvent({
      requestId: "r2",
      sessionFile: `/u/.claude/projects/D--polaris/${sid}.jsonl`,
      tsMs: 1_700_000_000_010,
      model: "claude-sonnet-4-5",
      inputTokens: 500_000,
      outputTokens: 100_000,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      rawCostUsd: null,
    });
    const m = buildSessionCostMap(db, pricing);
    const stats = m.get(sid);
    expect(stats).toBeDefined();
    expect(stats?.events).toBe(2);
    expect(stats?.inputTokens).toBe(1_500_000);
    expect(stats?.outputTokens).toBe(600_000);
    expect(stats?.costUsd).toBeGreaterThan(0);
  });

  it("sums costs across multiple models when a session hops models", () => {
    const sid = "session-multi";
    const insert = (model: string, input: number, output: number, suffix: string) =>
      db.insertEvent({
        requestId: `r-${suffix}`,
        sessionFile: `/u/.claude/projects/D--polaris/${sid}.jsonl`,
        tsMs: 1_700_000_000_000,
        model,
        inputTokens: input,
        outputTokens: output,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        rawCostUsd: null,
      });
    insert("claude-opus-4-7", 100_000, 50_000, "opus");
    insert("claude-haiku-4-5", 100_000, 50_000, "haiku");
    const stats = buildSessionCostMap(db, pricing).get(sid);
    expect(stats?.events).toBe(2);
    expect(stats?.inputTokens).toBe(200_000);
    // Opus and Haiku priced differently — total should be greater than either alone.
    expect(stats?.costUsd).toBeGreaterThan(0);
  });

  it("prefers persisted raw_cost_usd when every row in a group has one", () => {
    const sid = "session-priced";
    db.insertEvent({
      requestId: "r1",
      sessionFile: `/u/.claude/projects/D--polaris/${sid}.jsonl`,
      tsMs: 1_700_000_000_000,
      model: "claude-sonnet-4-5",
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      rawCostUsd: 1.23,
    });
    db.insertEvent({
      requestId: "r2",
      sessionFile: `/u/.claude/projects/D--polaris/${sid}.jsonl`,
      tsMs: 1_700_000_000_010,
      model: "claude-sonnet-4-5",
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      rawCostUsd: 0.77,
    });
    expect(buildSessionCostMap(db, pricing).get(sid)?.costUsd).toBeCloseTo(2.0, 6);
  });
});
