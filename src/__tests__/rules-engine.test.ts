import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type PolarisDb, openDb } from "../db.js";
import type { PricingTable } from "../metrics/pricing.js";
import { evaluateRules, startEngine } from "../rules/engine.js";

const PRICING: PricingTable = {
  patterns: [{ match: "claude-test", input: 3, output: 15, cacheRead: 0.3 }],
  fallback: { input: 3, output: 15, cacheRead: 0.3 },
};

function seedHighCostToday(db: PolarisDb): void {
  const todayStartMs = new Date();
  todayStartMs.setUTCHours(0, 0, 0, 0);
  db.insertEvent({
    requestId: "rule-engine-test-evt",
    sessionFile: "/tmp/p/s.jsonl",
    tsMs: todayStartMs.getTime() + 60_000,
    model: "claude-test",
    inputTokens: 0,
    outputTokens: 1_000_000,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    rawCostUsd: null,
  });
}

describe("evaluateRules", () => {
  let db: PolarisDb;

  beforeEach(() => {
    db = openDb(":memory:");
  });
  afterEach(() => {
    db.close();
  });

  it("returns empty when no rules are configured", () => {
    seedHighCostToday(db);
    const matches = evaluateRules(db, PRICING, {
      costThreshold: null,
      telegram: null,
      intervalMs: 1000,
    });
    expect(matches).toEqual([]);
  });

  it("returns the cost-threshold match when configured and crossed", () => {
    seedHighCostToday(db);
    const matches = evaluateRules(db, PRICING, {
      costThreshold: { thresholdUsd: 5 },
      telegram: null,
      intervalMs: 1000,
    });
    expect(matches).toHaveLength(1);
    expect(matches[0]?.ruleName).toBe("cost-threshold-daily");
  });
});

describe("startEngine().tick()", () => {
  let db: PolarisDb;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    db = openDb(":memory:");
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "{}",
    });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    db.close();
    vi.unstubAllGlobals();
  });

  it("dispatches via telegram and marks the notification as sent", async () => {
    seedHighCostToday(db);
    const logs: string[] = [];
    const engine = startEngine(
      db,
      PRICING,
      {
        costThreshold: { thresholdUsd: 5 },
        telegram: { botToken: "bot:abc", chatId: "555" },
        intervalMs: 60 * 60 * 1000,
      },
      (m) => logs.push(m),
    );
    try {
      await engine.tick();
    } finally {
      engine.stop();
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const today = new Date().toISOString().slice(0, 10);
    expect(db.wasNotified("cost-threshold-daily", today)).toBe(true);
    expect(logs[0]).toContain("sent cost-threshold-daily");
  });

  it("does not re-dispatch on a second tick within the same dedup window", async () => {
    seedHighCostToday(db);
    const engine = startEngine(db, PRICING, {
      costThreshold: { thresholdUsd: 5 },
      telegram: { botToken: "b", chatId: "c" },
      intervalMs: 60 * 60 * 1000,
    });
    try {
      await engine.tick();
      await engine.tick();
    } finally {
      engine.stop();
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT mark the notification when telegram fails", async () => {
    seedHighCostToday(db);
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "server error",
    });
    const logs: string[] = [];
    const engine = startEngine(
      db,
      PRICING,
      {
        costThreshold: { thresholdUsd: 5 },
        telegram: { botToken: "b", chatId: "c" },
        intervalMs: 60 * 60 * 1000,
      },
      (m) => logs.push(m),
    );
    try {
      await engine.tick();
    } finally {
      engine.stop();
    }
    const today = new Date().toISOString().slice(0, 10);
    expect(db.wasNotified("cost-threshold-daily", today)).toBe(false);
    expect(logs[0]).toContain("failed cost-threshold-daily");
  });
});
