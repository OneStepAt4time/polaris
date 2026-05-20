import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type PolarisDb, openDb } from "../db.js";
import { aggregateHeatmap, isHeatmapMetric } from "../metrics/heatmap.js";
import type { PricingTable } from "../metrics/pricing.js";

const PRICING: PricingTable = {
  patterns: [{ match: "claude-test", input: 3, output: 15, cacheRead: 0.3 }],
  fallback: { input: 3, output: 15, cacheRead: 0.3 },
};

function insertEvent(
  db: PolarisDb,
  opts: { sessionFile: string; tsMs: number; outputTokens: number; reqSuffix?: string },
): void {
  db.insertEvent({
    requestId: `req-${opts.tsMs}-${opts.outputTokens}-${opts.reqSuffix ?? ""}-${opts.sessionFile}`,
    sessionFile: opts.sessionFile,
    tsMs: opts.tsMs,
    model: "claude-test",
    inputTokens: 0,
    outputTokens: opts.outputTokens,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    rawCostUsd: null,
  });
}

describe("isHeatmapMetric", () => {
  it("accepts cost / events / outputTokens / sessions", () => {
    for (const m of ["cost", "events", "outputTokens", "sessions"]) {
      expect(isHeatmapMetric(m)).toBe(true);
    }
  });
  it("rejects unknown metrics", () => {
    expect(isHeatmapMetric("foo")).toBe(false);
    expect(isHeatmapMetric("")).toBe(false);
  });
});

describe("aggregateHeatmap", () => {
  let db: PolarisDb;
  const now = new Date("2026-05-20T12:00:00Z").getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const todayStartMs = new Date("2026-05-20T00:00:00Z").getTime();

  beforeEach(() => {
    db = openDb(":memory:");
  });
  afterEach(() => {
    db.close();
  });

  it("returns dailyValues of the requested length, padded with zeros", () => {
    const result = aggregateHeatmap(db, PRICING, "cost", 7, now);
    expect(result.days).toBe(7);
    expect(result.dailyValues).toHaveLength(7);
    expect(result.dailyValues.every((v) => v === 0)).toBe(true);
  });

  it("clamps days to [1, 365]", () => {
    expect(aggregateHeatmap(db, PRICING, "cost", 0, now).days).toBe(1);
    expect(aggregateHeatmap(db, PRICING, "cost", 9999, now).days).toBe(365);
  });

  it("places events in the correct dayIdx based on tsMs", () => {
    // 7-day window: dayIdx 0 = 2026-05-14, ..., dayIdx 6 = 2026-05-20
    insertEvent(db, {
      sessionFile: "/p/a/s.jsonl",
      tsMs: todayStartMs - 3 * dayMs + 1000,
      outputTokens: 100_000,
      reqSuffix: "a",
    });
    insertEvent(db, {
      sessionFile: "/p/a/s.jsonl",
      tsMs: todayStartMs + 1000,
      outputTokens: 200_000,
      reqSuffix: "b",
    });
    const result = aggregateHeatmap(db, PRICING, "outputTokens", 7, now);
    expect(result.dailyValues[3]).toBe(100_000); // 2026-05-17
    expect(result.dailyValues[6]).toBe(200_000); // 2026-05-20
    expect(result.dailyValues[0]).toBe(0);
  });

  it("counts events when metric=events", () => {
    insertEvent(db, {
      sessionFile: "/p/a/s.jsonl",
      tsMs: todayStartMs + 1,
      outputTokens: 100,
      reqSuffix: "a",
    });
    insertEvent(db, {
      sessionFile: "/p/a/s.jsonl",
      tsMs: todayStartMs + 2,
      outputTokens: 100,
      reqSuffix: "b",
    });
    const result = aggregateHeatmap(db, PRICING, "events", 7, now);
    expect(result.dailyValues[6]).toBe(2);
  });

  it("counts distinct sessions per day when metric=sessions", () => {
    insertEvent(db, {
      sessionFile: "/p/a/s-1.jsonl",
      tsMs: todayStartMs + 1,
      outputTokens: 100,
    });
    insertEvent(db, {
      sessionFile: "/p/a/s-1.jsonl",
      tsMs: todayStartMs + 2,
      outputTokens: 100,
      reqSuffix: "x",
    });
    insertEvent(db, {
      sessionFile: "/p/a/s-2.jsonl",
      tsMs: todayStartMs + 3,
      outputTokens: 100,
    });
    const result = aggregateHeatmap(db, PRICING, "sessions", 7, now);
    expect(result.dailyValues[6]).toBe(2); // 2 distinct session files today
  });

  it("derives firstDayOfWeekUtc from fromMs", () => {
    // 2026-05-14 (UTC) is a Thursday. UTC day: 4.
    const result = aggregateHeatmap(db, PRICING, "cost", 7, now);
    expect(result.firstDayOfWeekUtc).toBe(new Date(result.fromMs).getUTCDay());
  });
});
