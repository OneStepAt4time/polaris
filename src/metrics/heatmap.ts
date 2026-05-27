import type { PolarisDb } from "../db.js";
import { type PricingTable, computeCost } from "./pricing.js";
import { projectKey } from "./projects.js";

// v0.28.0: added "inputTokens" and "linesChanged" so the dashboard can show
// the same four heatmaps as CCMeter (Input / Output / Lines / Cost).
// "events" and "sessions" stay supported for back-compat.
export type HeatmapMetric =
  | "cost"
  | "events"
  | "inputTokens"
  | "outputTokens"
  | "linesChanged"
  | "sessions";

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

const METRICS: ReadonlySet<HeatmapMetric> = new Set([
  "cost",
  "events",
  "inputTokens",
  "outputTokens",
  "linesChanged",
  "sessions",
]);

export function isHeatmapMetric(value: string): value is HeatmapMetric {
  return METRICS.has(value as HeatmapMetric);
}

export interface HeatmapOptions {
  /** v0.31.0: restrict aggregation to events for this project (matches `projectKey`). */
  projectFilter?: string | null;
}

export function aggregateHeatmap(
  db: PolarisDb,
  pricing: PricingTable,
  metric: HeatmapMetric,
  days: number = DEFAULT_DAYS,
  now: number = Date.now(),
  opts: HeatmapOptions = {},
): HeatmapResult {
  const projectFilter = opts.projectFilter ?? null;
  const clamped = Math.max(1, Math.min(MAX_DAYS, Math.floor(days)));
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  const todayStartMs = today.getTime();
  const fromMs = todayStartMs - (clamped - 1) * DAY_MS;
  const rawEvents = db.getEventsInRange(fromMs, now);
  const events =
    projectFilter !== null
      ? rawEvents.filter((e) => projectKey(e.sessionFile) === projectFilter)
      : rawEvents;
  const dailyValues: number[] = Array(clamped).fill(0);
  const sessionsPerDay = new Map<number, Set<string>>();

  for (const event of events) {
    const dayIdx = Math.floor((event.tsMs - fromMs) / DAY_MS);
    if (dayIdx < 0 || dayIdx >= clamped) continue;
    if (metric === "cost") {
      dailyValues[dayIdx] = (dailyValues[dayIdx] ?? 0) + computeCost(event, pricing);
    } else if (metric === "events") {
      dailyValues[dayIdx] = (dailyValues[dayIdx] ?? 0) + 1;
    } else if (metric === "inputTokens") {
      dailyValues[dayIdx] = (dailyValues[dayIdx] ?? 0) + event.inputTokens;
    } else if (metric === "outputTokens") {
      dailyValues[dayIdx] = (dailyValues[dayIdx] ?? 0) + event.outputTokens;
    } else if (metric === "linesChanged") {
      dailyValues[dayIdx] =
        (dailyValues[dayIdx] ?? 0) + (event.linesAdded ?? 0) + (event.linesRemoved ?? 0);
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
