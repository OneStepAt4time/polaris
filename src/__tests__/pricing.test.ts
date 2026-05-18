import { describe, expect, it } from "vitest";
import { computeCost, loadPricing, priceLevelsFor } from "../metrics/pricing.js";

describe("loadPricing", () => {
  it("loads the bundled anthropic.json successfully", () => {
    const table = loadPricing();
    expect(table.patterns.length).toBeGreaterThan(0);
    expect(table.fallback.input).toBeGreaterThan(0);
  });
});

describe("priceLevelsFor", () => {
  const table = loadPricing();

  it("matches sonnet by substring", () => {
    const levels = priceLevelsFor("claude-sonnet-4-5", table);
    expect(levels.input).toBe(3.0);
    expect(levels.output).toBe(15.0);
    expect(levels.cacheRead).toBe(0.3);
  });

  it("matches opus 4-6 with its specific tier", () => {
    const levels = priceLevelsFor("claude-opus-4-6-20260101", table);
    expect(levels.input).toBe(5.0);
    expect(levels.output).toBe(25.0);
  });

  it("matches haiku 4-5", () => {
    const levels = priceLevelsFor("claude-haiku-4-5", table);
    expect(levels.input).toBe(1.0);
  });

  it("falls back when model is unknown", () => {
    const levels = priceLevelsFor("some-future-model-no-match", table);
    expect(levels).toEqual(table.fallback);
  });

  it("first pattern match wins (order matters)", () => {
    const customTable = {
      patterns: [
        { match: "sonnet", input: 999, output: 999, cacheRead: 99 },
        { match: "sonnet-4", input: 1, output: 1, cacheRead: 1 },
      ],
      fallback: { input: 3, output: 15, cacheRead: 0.3 },
    };
    const levels = priceLevelsFor("claude-sonnet-4-5", customTable);
    expect(levels.input).toBe(999);
  });
});

describe("computeCost", () => {
  const table = loadPricing();

  it("returns rawCostUsd verbatim when present", () => {
    const cost = computeCost(
      {
        model: "claude-sonnet-4-5",
        inputTokens: 999,
        outputTokens: 999,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        rawCostUsd: 0.42,
      },
      table,
    );
    expect(cost).toBe(0.42);
  });

  it("computes from tokens when rawCostUsd is null (sonnet)", () => {
    const cost = computeCost(
      {
        model: "claude-sonnet-4-5",
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        rawCostUsd: null,
      },
      table,
    );
    expect(cost).toBeCloseTo(3.0 + 15.0, 6);
  });

  it("uses fallback prices for unknown model", () => {
    const cost = computeCost(
      {
        model: "totally-new-model",
        inputTokens: 1_000_000,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        rawCostUsd: null,
      },
      table,
    );
    expect(cost).toBeCloseTo(table.fallback.input, 6);
  });

  it("includes cache_read at its discounted rate", () => {
    const cost = computeCost(
      {
        model: "claude-sonnet-4-5",
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 1_000_000,
        cacheCreationTokens: 0,
        rawCostUsd: null,
      },
      table,
    );
    expect(cost).toBeCloseTo(0.3, 6);
  });

  it("returns 0 for zero tokens and no raw cost", () => {
    const cost = computeCost(
      {
        model: "claude-sonnet-4-5",
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        rawCostUsd: null,
      },
      table,
    );
    expect(cost).toBe(0);
  });
});
