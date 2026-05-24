import type { PolarisDb } from "../db.js";
import { type PricingTable, computeCost } from "./pricing.js";

export interface PerModelMetrics {
  model: string;
  events: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  /** Lines added by tool calls aggregated to this model. v0.23.0. */
  linesAdded: number;
  /** Lines removed by tool calls aggregated to this model. v0.23.0. */
  linesRemoved: number;
}

export interface MetricsTotals {
  events: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  /** Lines added by tool calls in this window. v0.23.0. */
  linesAdded: number;
  /** Lines removed by tool calls in this window. v0.23.0. */
  linesRemoved: number;
}

export interface MetricsResult {
  range: string;
  fromMs: number;
  toMs: number;
  totals: MetricsTotals;
  perModel: PerModelMetrics[];
}

export type TimeRange = "1h" | "12h" | "today" | "7d" | "30d" | "all";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function resolveRange(
  range: TimeRange,
  now: number = Date.now(),
): { fromMs: number; toMs: number } {
  switch (range) {
    case "1h":
      return { fromMs: now - HOUR_MS, toMs: now };
    case "12h":
      return { fromMs: now - 12 * HOUR_MS, toMs: now };
    case "today": {
      const today = new Date(now);
      today.setUTCHours(0, 0, 0, 0);
      return { fromMs: today.getTime(), toMs: now };
    }
    case "7d":
      return { fromMs: now - 7 * DAY_MS, toMs: now };
    case "30d":
      return { fromMs: now - 30 * DAY_MS, toMs: now };
    case "all":
      return { fromMs: 0, toMs: now };
  }
}

export function aggregate(
  db: PolarisDb,
  range: string,
  fromMs: number,
  toMs: number,
  pricing: PricingTable,
): MetricsResult {
  // v0.24.0: push SUM/GROUP BY down to SQLite. Returns ~N-models rows
  // (typically 3-7) instead of pulling every event into JS — measured a 15x
  // p99 improvement at 10k events. The per-event computeCost() loop is
  // replaced by N model-level cost calculations using the SUM'd token totals.
  const rows = db.aggregateByModel(fromMs, toMs);

  const totals: MetricsTotals = {
    events: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costUsd: 0,
    linesAdded: 0,
    linesRemoved: 0,
  };
  const perModel: PerModelMetrics[] = [];

  for (const row of rows) {
    // computeCost on a synthetic event: same pricing-lookup logic, but with
    // SUM'd token counts so we only do it once per model rather than per
    // event. raw_cost_usd, if persisted, wins over the computed value — we
    // preserve that semantics by checking if rawCostUsdCount === events.
    const cost =
      row.rawCostUsdSum !== null && row.rawCostUsdCount === row.events
        ? row.rawCostUsdSum
        : computeCost(
            {
              model: row.model,
              inputTokens: row.inputTokens,
              outputTokens: row.outputTokens,
              cacheReadTokens: row.cacheReadTokens,
              cacheCreationTokens: row.cacheCreationTokens,
              rawCostUsd: null,
            },
            pricing,
          );
    totals.events += row.events;
    totals.inputTokens += row.inputTokens;
    totals.outputTokens += row.outputTokens;
    totals.cacheReadTokens += row.cacheReadTokens;
    totals.cacheCreationTokens += row.cacheCreationTokens;
    totals.costUsd += cost;
    totals.linesAdded += row.linesAdded;
    totals.linesRemoved += row.linesRemoved;
    perModel.push({
      model: row.model,
      events: row.events,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      cacheReadTokens: row.cacheReadTokens,
      cacheCreationTokens: row.cacheCreationTokens,
      costUsd: cost,
      linesAdded: row.linesAdded,
      linesRemoved: row.linesRemoved,
    });
  }
  perModel.sort((a, b) => b.costUsd - a.costUsd);

  return {
    range,
    fromMs,
    toMs,
    totals,
    perModel,
  };
}
