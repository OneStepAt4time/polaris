import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type EventRow, type PolarisDb, openDb } from "../db.js";
import {
  aggregate,
  computeActivity,
  resolvePreviousRange,
  resolveRange,
} from "../metrics/aggregator.js";
import { loadPricing } from "../metrics/pricing.js";

const pricing = loadPricing();

function sample(overrides: Partial<EventRow> = {}): EventRow {
  return {
    requestId: `req_${Math.random().toString(36).slice(2)}`,
    sessionFile: "session.jsonl",
    tsMs: 1_700_000_000_000,
    model: "claude-sonnet-4-5",
    inputTokens: 1000,
    outputTokens: 500,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    rawCostUsd: null,
    ...overrides,
  };
}

describe("aggregate", () => {
  let db: PolarisDb;

  beforeEach(() => {
    db = openDb(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("returns zeroed totals when DB is empty", () => {
    const result = aggregate(db, "today", 0, Date.now(), pricing);
    expect(result.totals.events).toBe(0);
    expect(result.totals.inputTokens).toBe(0);
    expect(result.totals.costUsd).toBe(0);
    expect(result.perModel).toHaveLength(0);
  });

  it("sums tokens and cost across multiple events of the same model", () => {
    db.insertEvent(sample({ requestId: "a", inputTokens: 1_000_000, outputTokens: 0 }));
    db.insertEvent(sample({ requestId: "b", inputTokens: 1_000_000, outputTokens: 0 }));
    const result = aggregate(db, "all", 0, Date.now() + 1, pricing);
    expect(result.totals.events).toBe(2);
    expect(result.totals.inputTokens).toBe(2_000_000);
    expect(result.totals.costUsd).toBeCloseTo(6.0, 6); // 2 × 1M × $3
    expect(result.perModel).toHaveLength(1);
    expect(result.perModel[0]?.events).toBe(2);
  });

  it("breaks down per-model with costs sorted descending", () => {
    db.insertEvent(sample({ requestId: "h", model: "claude-haiku-4-5", inputTokens: 1_000_000 }));
    db.insertEvent(
      sample({ requestId: "o", model: "claude-opus-4-6-20260101", inputTokens: 1_000_000 }),
    );
    db.insertEvent(sample({ requestId: "s", model: "claude-sonnet-4-5", inputTokens: 1_000_000 }));
    const result = aggregate(db, "all", 0, Date.now() + 1, pricing);
    expect(result.perModel).toHaveLength(3);
    // Opus ($5) > Sonnet ($3) > Haiku ($1)
    expect(result.perModel[0]?.model).toBe("claude-opus-4-6-20260101");
    expect(result.perModel[1]?.model).toBe("claude-sonnet-4-5");
    expect(result.perModel[2]?.model).toBe("claude-haiku-4-5");
  });

  it("prefers raw_cost_usd when present", () => {
    db.insertEvent(sample({ requestId: "r", rawCostUsd: 0.5, inputTokens: 0, outputTokens: 0 }));
    const result = aggregate(db, "all", 0, Date.now() + 1, pricing);
    expect(result.totals.costUsd).toBe(0.5);
  });

  it("respects time range bounds", () => {
    db.insertEvent(sample({ requestId: "old", tsMs: 1_000 }));
    db.insertEvent(sample({ requestId: "new", tsMs: 5_000 }));
    const result = aggregate(db, "custom", 2_000, 6_000, pricing);
    expect(result.totals.events).toBe(1);
  });

  it("v0.23.0: sums linesAdded/linesRemoved into totals and per-model breakdown", () => {
    db.insertEvent(sample({ requestId: "a", linesAdded: 10, linesRemoved: 5 }));
    db.insertEvent(sample({ requestId: "b", linesAdded: 3, linesRemoved: 0 }));
    db.insertEvent(
      sample({
        requestId: "c",
        model: "claude-haiku-4-5",
        linesAdded: 7,
        linesRemoved: 2,
      }),
    );
    const result = aggregate(db, "all", 0, Date.now() + 1, pricing);
    expect(result.totals.linesAdded).toBe(20);
    expect(result.totals.linesRemoved).toBe(7);
    const sonnet = result.perModel.find((m) => m.model === "claude-sonnet-4-5");
    const haiku = result.perModel.find((m) => m.model === "claude-haiku-4-5");
    expect(sonnet?.linesAdded).toBe(13);
    expect(sonnet?.linesRemoved).toBe(5);
    expect(haiku?.linesAdded).toBe(7);
    expect(haiku?.linesRemoved).toBe(2);
  });

  it("v0.23.0: linesAdded/linesRemoved default to 0 when EventRow omits them", () => {
    db.insertEvent(sample({ requestId: "no-lines" }));
    const result = aggregate(db, "all", 0, Date.now() + 1, pricing);
    expect(result.totals.linesAdded).toBe(0);
    expect(result.totals.linesRemoved).toBe(0);
  });

  it("v0.28.0: empty DB returns zero activity metrics", () => {
    const r = aggregate(db, "today", 0, Date.now(), pricing);
    expect(r.totals.activeDays).toBe(0);
    expect(r.totals.streak).toBe(0);
    expect(r.totals.avgOutputPerActiveDay).toBe(0);
    expect(r.totals.windowDays).toBeGreaterThanOrEqual(1);
  });

  it("v0.28.0: activeDays + avgOutputPerActiveDay match real data", () => {
    const dayMs = 24 * 60 * 60 * 1000;
    const today = Math.floor(Date.now() / dayMs) * dayMs;
    db.insertEvent(sample({ requestId: "x", tsMs: today, outputTokens: 1000 }));
    db.insertEvent(sample({ requestId: "y", tsMs: today - dayMs, outputTokens: 500 }));
    const r = aggregate(db, "7d", today - 6 * dayMs, today + dayMs - 1, pricing);
    expect(r.totals.activeDays).toBe(2);
    // 1500 output tokens across 2 active days
    expect(r.totals.avgOutputPerActiveDay).toBeCloseTo(750, 1);
  });

  it("v0.31.0: projectFilter restricts totals + perModel to events in that project", () => {
    db.insertEvent(
      sample({
        requestId: "a",
        sessionFile: "/home/u/.claude/projects/D--polaris/s.jsonl",
        inputTokens: 100,
        outputTokens: 200,
      }),
    );
    db.insertEvent(
      sample({
        requestId: "b",
        sessionFile: "/home/u/.claude/projects/D--aegis/s.jsonl",
        inputTokens: 700,
        outputTokens: 900,
      }),
    );
    const r = aggregate(db, "all", 0, Date.now() + 1, pricing, {
      projectFilter: "D--polaris",
    });
    expect(r.totals.events).toBe(1);
    expect(r.totals.inputTokens).toBe(100);
    expect(r.totals.outputTokens).toBe(200);
    expect(r.perModel).toHaveLength(1);
  });

  it("v0.31.0: projectFilter=null behaves identically to unfiltered (SQL fast-path)", () => {
    db.insertEvent(
      sample({
        requestId: "a",
        sessionFile: "/u/.claude/projects/D--polaris/s.jsonl",
        outputTokens: 100,
      }),
    );
    db.insertEvent(
      sample({
        requestId: "b",
        sessionFile: "/u/.claude/projects/D--aegis/s.jsonl",
        outputTokens: 300,
      }),
    );
    const unfilt = aggregate(db, "all", 0, Date.now() + 1, pricing);
    const explicit = aggregate(db, "all", 0, Date.now() + 1, pricing, { projectFilter: null });
    expect(unfilt.totals.events).toBe(explicit.totals.events);
    expect(unfilt.totals.outputTokens).toBe(explicit.totals.outputTokens);
    expect(unfilt.totals.costUsd).toBeCloseTo(explicit.totals.costUsd, 6);
  });

  it("v0.31.0: projectFilter on a project with no events returns zeros", () => {
    db.insertEvent(
      sample({
        requestId: "a",
        sessionFile: "/u/.claude/projects/D--polaris/s.jsonl",
        outputTokens: 100,
      }),
    );
    const r = aggregate(db, "all", 0, Date.now() + 1, pricing, {
      projectFilter: "no-such-project",
    });
    expect(r.totals.events).toBe(0);
    expect(r.perModel).toEqual([]);
  });
});

describe("computeActivity (v0.28.0)", () => {
  const dayMs = 24 * 60 * 60 * 1000;
  const today = Math.floor(Date.parse("2026-05-21T15:30:00.000Z") / dayMs) * dayMs;

  it("returns 0 for an empty list", () => {
    const a = computeActivity([], today - 6 * dayMs, today);
    expect(a.activeDays).toBe(0);
    expect(a.streak).toBe(0);
  });

  it("computes streak of N when last N consecutive days are active", () => {
    const days = [today - 2 * dayMs, today - dayMs, today];
    const a = computeActivity(days, today - 6 * dayMs, today);
    expect(a.activeDays).toBe(3);
    expect(a.streak).toBe(3);
  });

  it("returns streak 0 when the latest window day is not active", () => {
    // gap on `today`; previous days active.
    const days = [today - 3 * dayMs, today - 2 * dayMs];
    const a = computeActivity(days, today - 6 * dayMs, today);
    expect(a.activeDays).toBe(2);
    expect(a.streak).toBe(0);
  });

  it("windowDays counts the inclusive day span", () => {
    const a = computeActivity([], today - 6 * dayMs, today);
    expect(a.windowDays).toBe(7);
  });
});

describe("resolveRange", () => {
  const now = Date.parse("2026-05-17T15:30:00.000Z");

  it("computes 1h window correctly", () => {
    const r = resolveRange("1h", now);
    expect(now - r.fromMs).toBe(60 * 60 * 1000);
    expect(r.toMs).toBe(now);
  });

  it("computes 12h window correctly", () => {
    const r = resolveRange("12h", now);
    expect(now - r.fromMs).toBe(12 * 60 * 60 * 1000);
    expect(r.toMs).toBe(now);
  });

  it("computes today as UTC midnight to now", () => {
    const r = resolveRange("today", now);
    expect(new Date(r.fromMs).toISOString()).toBe("2026-05-17T00:00:00.000Z");
    expect(r.toMs).toBe(now);
  });

  it("computes 7d window correctly", () => {
    const r = resolveRange("7d", now);
    expect(now - r.fromMs).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("computes 30d window correctly", () => {
    const r = resolveRange("30d", now);
    expect(now - r.fromMs).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("returns fromMs=0 for 'all'", () => {
    const r = resolveRange("all", now);
    expect(r.fromMs).toBe(0);
    expect(r.toMs).toBe(now);
  });
});

describe("resolvePreviousRange (v0.25.0)", () => {
  const now = Date.parse("2026-05-21T15:30:00.000Z");
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;

  it("returns null for 'all' (no meaningful predecessor)", () => {
    expect(resolvePreviousRange("all", now)).toBeNull();
  });

  it("1h -> hour before the current hour", () => {
    const r = resolvePreviousRange("1h", now);
    expect(r).toEqual({ fromMs: now - 2 * HOUR, toMs: now - HOUR });
  });

  it("12h -> 12 hours before the 12h window", () => {
    const r = resolvePreviousRange("12h", now);
    expect(r).toEqual({ fromMs: now - 24 * HOUR, toMs: now - 12 * HOUR });
  });

  it("today -> yesterday truncated to same elapsed-of-day", () => {
    const r = resolvePreviousRange("today", now);
    // 2026-05-21T00:00:00 → 2026-05-21T15:30:00 is the current day window.
    // Previous: 2026-05-20T00:00:00 → 2026-05-20T15:30:00.
    expect(r).not.toBeNull();
    expect(new Date(r?.fromMs ?? 0).toISOString()).toBe("2026-05-20T00:00:00.000Z");
    expect(new Date(r?.toMs ?? 0).toISOString()).toBe("2026-05-20T15:30:00.000Z");
  });

  it("7d -> the preceding 7d window", () => {
    const r = resolvePreviousRange("7d", now);
    expect(r).toEqual({ fromMs: now - 14 * DAY, toMs: now - 7 * DAY });
  });

  it("30d -> the preceding 30d window", () => {
    const r = resolvePreviousRange("30d", now);
    expect(r).toEqual({ fromMs: now - 60 * DAY, toMs: now - 30 * DAY });
  });
});
