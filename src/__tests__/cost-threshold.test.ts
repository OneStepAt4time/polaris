import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type PolarisDb, openDb } from "../db.js";
import type { PricingTable } from "../metrics/pricing.js";
import { checkCostThreshold } from "../rules/cost-threshold.js";

const PRICING: PricingTable = {
  patterns: [
    {
      match: "claude-test",
      input: 3.0,
      output: 15.0,
      cacheRead: 0.3,
    },
  ],
  fallback: { input: 3.0, output: 15.0, cacheRead: 0.3 },
};

function insertEvent(db: PolarisDb, opts: { tsMs: number; outputTokens: number }): void {
  db.insertEvent({
    requestId: `req-${opts.tsMs}-${opts.outputTokens}`,
    sessionFile: "/tmp/p/s.jsonl",
    tsMs: opts.tsMs,
    model: "claude-test",
    inputTokens: 0,
    outputTokens: opts.outputTokens,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    rawCostUsd: null,
  });
}

describe("checkCostThreshold", () => {
  let db: PolarisDb;
  const now = new Date("2026-05-20T12:00:00Z").getTime();
  const todayStartMs = new Date("2026-05-20T00:00:00Z").getTime();
  const yesterdayStartMs = new Date("2026-05-19T12:00:00Z").getTime();

  beforeEach(() => {
    db = openDb(":memory:");
  });
  afterEach(() => {
    db.close();
  });

  it("returns null when threshold is 0 (rule disabled)", () => {
    insertEvent(db, { tsMs: now - 60_000, outputTokens: 1_000_000 });
    expect(checkCostThreshold(db, PRICING, { thresholdUsd: 0 }, now)).toBeNull();
  });

  it("returns null when today's cost is below the threshold", () => {
    // 100k output tokens @ $15/1M = $1.50
    insertEvent(db, { tsMs: todayStartMs + 60_000, outputTokens: 100_000 });
    expect(checkCostThreshold(db, PRICING, { thresholdUsd: 5 }, now)).toBeNull();
  });

  it("returns a match with today's date as dedup key when threshold is crossed", () => {
    // 1M output tokens @ $15/1M = $15.00
    insertEvent(db, { tsMs: todayStartMs + 60_000, outputTokens: 1_000_000 });
    const match = checkCostThreshold(db, PRICING, { thresholdUsd: 5 }, now);
    expect(match).not.toBeNull();
    expect(match?.ruleName).toBe("cost-threshold-daily");
    expect(match?.dedupKey).toBe("2026-05-20");
    expect(match?.message).toContain("$15.00");
    expect(match?.message).toContain("$5.00");
  });

  it("ignores events from yesterday when summing today's spend", () => {
    insertEvent(db, { tsMs: yesterdayStartMs, outputTokens: 5_000_000 });
    insertEvent(db, { tsMs: todayStartMs + 60_000, outputTokens: 50_000 });
    expect(checkCostThreshold(db, PRICING, { thresholdUsd: 5 }, now)).toBeNull();
  });
});
