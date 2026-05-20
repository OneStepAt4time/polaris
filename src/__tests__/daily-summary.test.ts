import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type PolarisDb, openDb } from "../db.js";
import type { PricingTable } from "../metrics/pricing.js";
import { checkDailySummary } from "../rules/daily-summary.js";

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

describe("checkDailySummary", () => {
  let db: PolarisDb;
  const todayStartMs = new Date("2026-05-20T00:00:00Z").getTime();
  const before23Utc = new Date("2026-05-20T22:30:00Z").getTime();
  const at23Utc = new Date("2026-05-20T23:00:00Z").getTime();
  const at2330Utc = new Date("2026-05-20T23:30:00Z").getTime();

  beforeEach(() => {
    db = openDb(":memory:");
  });
  afterEach(() => {
    db.close();
  });

  it("returns null before the configured UTC hour", () => {
    insertEvent(db, { sessionFile: "/p/x/s.jsonl", tsMs: todayStartMs + 1000, outputTokens: 100 });
    expect(checkDailySummary(db, PRICING, { hourUtc: 23 }, before23Utc)).toBeNull();
  });

  it("returns null when there are no events today (no spam on idle days)", () => {
    expect(checkDailySummary(db, PRICING, { hourUtc: 23 }, at23Utc)).toBeNull();
  });

  it("emits a match at or after the configured hour with today's totals", () => {
    insertEvent(db, {
      sessionFile: "/p/aegis/s.jsonl",
      tsMs: todayStartMs + 1000,
      outputTokens: 200_000,
    });
    const match = checkDailySummary(db, PRICING, { hourUtc: 23 }, at23Utc);
    expect(match).not.toBeNull();
    expect(match?.ruleName).toBe("daily-summary");
    expect(match?.dedupKey).toBe("2026-05-20");
    expect(match?.message).toContain("daily summary (2026-05-20)");
    expect(match?.message).toContain("Cost: `$3.00`"); // 200k * 15/1M = 3.00
    expect(match?.message).toContain("Events: `1`");
    expect(match?.message).toContain("aegis");
  });

  it("includes top 3 projects ranked by today's cost", () => {
    insertEvent(db, {
      sessionFile: "/p/a/s.jsonl",
      tsMs: todayStartMs + 1,
      outputTokens: 100_000,
      reqSuffix: "a",
    });
    insertEvent(db, {
      sessionFile: "/p/b/s.jsonl",
      tsMs: todayStartMs + 2,
      outputTokens: 500_000,
      reqSuffix: "b",
    });
    insertEvent(db, {
      sessionFile: "/p/c/s.jsonl",
      tsMs: todayStartMs + 3,
      outputTokens: 50_000,
      reqSuffix: "c",
    });
    insertEvent(db, {
      sessionFile: "/p/d/s.jsonl",
      tsMs: todayStartMs + 4,
      outputTokens: 25_000,
      reqSuffix: "d",
    });
    const match = checkDailySummary(db, PRICING, { hourUtc: 23 }, at23Utc);
    expect(match?.message).toMatch(/1\. `b`.*2\. `a`.*3\. `c`/s);
    expect(match?.message).not.toContain("`d`");
  });

  it("uses dedupKey=YYYY-MM-DD (UTC) so it fires exactly once per day", () => {
    insertEvent(db, { sessionFile: "/p/x/s.jsonl", tsMs: todayStartMs, outputTokens: 100 });
    const m1 = checkDailySummary(db, PRICING, { hourUtc: 23 }, at23Utc);
    const m2 = checkDailySummary(db, PRICING, { hourUtc: 23 }, at2330Utc);
    expect(m1?.dedupKey).toBe("2026-05-20");
    expect(m2?.dedupKey).toBe("2026-05-20");
  });
});
