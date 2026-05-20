import type { PolarisDb } from "../db.js";
import { type PricingTable, computeCost } from "./pricing.js";

export type HeatmapMetric = "cost" | "events" | "outputTokens" | "sessions";

export interface HeatmapResult {
  days: number;
  metric: HeatmapMetric;
  fromMs: number;
  toMs: number;
  firstDayOfWeekUtc: number;
  dailyValues: number[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAYS = 180;
const MAX_DAYS = 365;

const METRICS: ReadonlySet<HeatmapMetric> = new Set(["cost", "events", "outputTokens", "sessions"]);

export function isHeatmapMetric(value: string): value is HeatmapMetric {
  return METRICS.has(value as HeatmapMetric);
}

export function aggregateHeatmap(
  db: PolarisDb,
  pricing: PricingTable,
  metric: HeatmapMetric,
  days: number = DEFAULT_DAYS,
  now: number = Date.now(),
): HeatmapResult {
  const clamped = Math.max(1, Math.min(MAX_DAYS, Math.floor(days)));
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  const todayStartMs = today.getTime();
  const fromMs = todayStartMs - (clamped - 1) * DAY_MS;
  const events = db.getEventsInRange(fromMs, now);
  const dailyValues: number[] = Array(clamped).fill(0);
  const sessionsPerDay = new Map<number, Set<string>>();

  for (const event of events) {
    const dayIdx = Math.floor((event.tsMs - fromMs) / DAY_MS);
    if (dayIdx < 0 || dayIdx >= clamped) continue;
    if (metric === "cost") {
      dailyValues[dayIdx] = (dailyValues[dayIdx] ?? 0) + computeCost(event, pricing);
    } else if (metric === "events") {
      dailyValues[dayIdx] = (dailyValues[dayIdx] ?? 0) + 1;
    } else if (metric === "outputTokens") {
      dailyValues[dayIdx] = (dailyValues[dayIdx] ?? 0) + event.outputTokens;
    } else if (metric === "sessions") {
      let set = sessionsPerDay.get(dayIdx);
      if (set === undefined) {
        set = new Set();
        sessionsPerDay.set(dayIdx, set);
      }
      set.add(event.sessionFile);
    }
  }
  if (metric === "sessions") {
    for (const [idx, set] of sessionsPerDay) {
      dailyValues[idx] = set.size;
    }
  }
  return {
    days: clamped,
    metric,
    fromMs,
    toMs: now,
    firstDayOfWeekUtc: new Date(fromMs).getUTCDay(),
    dailyValues,
  };
}
