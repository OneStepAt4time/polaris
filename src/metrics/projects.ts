import { basename, dirname } from "node:path";
import type { PolarisDb } from "../db.js";
import { type PricingTable, computeCost } from "./pricing.js";

export interface ProjectMetrics {
  name: string;
  events: number;
  sessions: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  dailyCostUsd: number[];
}

export interface ProjectsResult {
  days: number;
  fromMs: number;
  toMs: number;
  projects: ProjectMetrics[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAYS = 30;
const MAX_DAYS = 365;

export function projectKey(sessionFile: string): string {
  const normalized = sessionFile.replace(/\\/g, "/");
  const parent = dirname(normalized);
  const key = basename(parent);
  return key === "" || key === "." ? "(root)" : key;
}

export function resolveProjectsWindow(
  days: number,
  now: number,
): { fromMs: number; toMs: number; days: number } {
  const clamped = Math.max(1, Math.min(MAX_DAYS, Math.floor(days)));
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  const todayStart = today.getTime();
  const fromMs = todayStart - (clamped - 1) * DAY_MS;
  return { fromMs, toMs: now, days: clamped };
}

export function aggregateByProject(
  db: PolarisDb,
  pricing: PricingTable,
  days: number = DEFAULT_DAYS,
  now: number = Date.now(),
): ProjectsResult {
  const window = resolveProjectsWindow(days, now);
  const events = db.getEventsInRange(window.fromMs, window.toMs);
  const byProject = new Map<string, ProjectMetrics>();
  const sessionsPerProject = new Map<string, Set<string>>();
  const todayStartMs = new Date(now);
  todayStartMs.setUTCHours(0, 0, 0, 0);

  for (const event of events) {
    const key = projectKey(event.sessionFile);
    const cost = computeCost(event, pricing);
    let proj = byProject.get(key);
    if (proj === undefined) {
      proj = {
        name: key,
        events: 0,
        sessions: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        costUsd: 0,
        dailyCostUsd: Array(window.days).fill(0),
      };
      byProject.set(key, proj);
      sessionsPerProject.set(key, new Set());
    }
    proj.events += 1;
    proj.inputTokens += event.inputTokens;
    proj.outputTokens += event.outputTokens;
    proj.cacheReadTokens += event.cacheReadTokens;
    proj.cacheCreationTokens += event.cacheCreationTokens;
    proj.costUsd += cost;
    sessionsPerProject.get(key)?.add(event.sessionFile);

    const dayIdx = Math.floor((event.tsMs - window.fromMs) / DAY_MS);
    if (dayIdx >= 0 && dayIdx < window.days) {
      const current = proj.dailyCostUsd[dayIdx] ?? 0;
      proj.dailyCostUsd[dayIdx] = current + cost;
    }
  }

  for (const [key, set] of sessionsPerProject) {
    const proj = byProject.get(key);
    if (proj !== undefined) proj.sessions = set.size;
  }

  return {
    days: window.days,
    fromMs: window.fromMs,
    toMs: window.toMs,
    projects: [...byProject.values()].sort((a, b) => b.costUsd - a.costUsd),
  };
}
