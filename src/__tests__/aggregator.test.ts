import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type EventRow, type PolarisDb, openDb } from "../db.js";
import { aggregate, resolveRange } from "../metrics/aggregator.js";
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
