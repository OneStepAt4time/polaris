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
}

export interface MetricsTotals {
  events: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
}

export interface MetricsResult {
  range: string;
  fromMs: number;
  toMs: number;
  totals: MetricsTotals;
  perModel: PerModelMetrics[];
}

export type TimeRange = "today" | "7d" | "30d" | "all";

const DAY_MS = 24 * 60 * 60 * 1000;

export function resolveRange(
  range: TimeRange,
  now: number = Date.now(),
): { fromMs: number; toMs: number } {
  switch (range) {
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
  const events = db.getEventsInRange(fromMs, toMs);

  const totals: MetricsTotals = {
    events: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costUsd: 0,
  };

  const byModel = new Map<string, PerModelMetrics>();

  for (const event of events) {
    const cost = computeCost(event, pricing);

    totals.events += 1;
    totals.inputTokens += event.inputTokens;
    totals.outputTokens += event.outputTokens;
    totals.cacheReadTokens += event.cacheReadTokens;
    totals.cacheCreationTokens += event.cacheCreationTokens;
    totals.costUsd += cost;

    let perModel = byModel.get(event.model);
    if (perModel === undefined) {
      perModel = {
        model: event.model,
        events: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        costUsd: 0,
      };
      byModel.set(event.model, perModel);
    }
    perModel.events += 1;
    perModel.inputTokens += event.inputTokens;
    perModel.outputTokens += event.outputTokens;
    perModel.cacheReadTokens += event.cacheReadTokens;
    perModel.cacheCreationTokens += event.cacheCreationTokens;
    perModel.costUsd += cost;
  }

  return {
    range,
    fromMs,
    toMs,
    totals,
    perModel: [...byModel.values()].sort((a, b) => b.costUsd - a.costUsd),
  };
}
