import { basename, dirname } from "node:path";
import type { PolarisDb } from "../db.js";
import { type PricingTable, computeCost } from "./pricing.js";

/**
 * Per-project metrics surfaced by /v1/projects. Mirrors the information
 * density of a CCMeter project card so the UI can render it 1:1.
 */
export interface ProjectMetrics {
  name: string;
  events: number;
  sessions: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  /** v0.29.0: sum of `lines_added` across this project's events. */
  linesAdded: number;
  /** v0.29.0: sum of `lines_removed` across this project's events. */
  linesRemoved: number;
  /**
   * v0.29.0: total active milliseconds estimated from event timestamps —
   * sum of intra-session gaps under ACTIVE_GAP_MS plus a TAIL_MS credit
   * per session so a singleton event still registers as ~1 minute.
   */
  activeMs: number;
  /**
   * v0.29.0: output tokens per line added (0 when no lines). Mirrors
   * CCMeter's efficiency score on each card.
   */
  outputPerLine: number;
  /** Daily cost array, one entry per UTC day in the window. */
  dailyCostUsd: number[];
  /**
   * v0.29.0: daily output-tokens per model family ({opus,sonnet,haiku,other}).
   * Drives the stacked sparkline at the bottom of each card.
   */
  dailyByFamily: Record<ModelFamily, number[]>;
}

export interface ProjectsResult {
  days: number;
  fromMs: number;
  toMs: number;
  projects: ProjectMetrics[];
}

export type ModelFamily = "opus" | "sonnet" | "haiku" | "other";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAYS = 30;
const MAX_DAYS = 365;
/**
 * Two events under this gap count as the same "active stretch" and the gap
 * is added to activeMs. Above the gap, we start a new stretch (idle time
 * is excluded). Matches CCMeter's 5-minute idle window.
 */
const ACTIVE_GAP_MS = 5 * 60 * 1000;
/** Tail credited per session so singletons don't read as 0 minutes. */
const TAIL_MS = 60 * 1000;

export function projectKey(sessionFile: string): string {
  const normalized = sessionFile.replace(/\\/g, "/");
  const parent = dirname(normalized);
  const key = basename(parent);
  return key === "" || key === "." ? "(root)" : key;
}

/**
 * Buckets a raw model id into one of the four families used on project
 * cards. Substring match against the canonical Anthropic naming, with
 * "other" as the catch-all for anything we don't recognise (e.g. custom
 * model proxies). Exported for unit tests.
 */
export function modelFamily(model: string): ModelFamily {
  const m = model.toLowerCase();
  if (m.includes("opus")) return "opus";
  if (m.includes("sonnet")) return "sonnet";
  if (m.includes("haiku")) return "haiku";
  return "other";
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

function emptyDailyByFamily(days: number): Record<ModelFamily, number[]> {
  return {
    opus: Array(days).fill(0),
    sonnet: Array(days).fill(0),
    haiku: Array(days).fill(0),
    other: Array(days).fill(0),
  };
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
  // Active-time tracking is per (project, session) so two sessions
  // overlapping in time on the same project don't fold their idle gap
  // into one inflated stretch.
  const lastTsBySession = new Map<string, Map<string, number>>();

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
        linesAdded: 0,
        linesRemoved: 0,
        activeMs: 0,
        outputPerLine: 0,
        dailyCostUsd: Array(window.days).fill(0),
        dailyByFamily: emptyDailyByFamily(window.days),
      };
      byProject.set(key, proj);
      sessionsPerProject.set(key, new Set());
      lastTsBySession.set(key, new Map());
    }
    proj.events += 1;
    proj.inputTokens += event.inputTokens;
    proj.outputTokens += event.outputTokens;
    proj.cacheReadTokens += event.cacheReadTokens;
    proj.cacheCreationTokens += event.cacheCreationTokens;
    proj.costUsd += cost;
    proj.linesAdded += event.linesAdded ?? 0;
    proj.linesRemoved += event.linesRemoved ?? 0;
    sessionsPerProject.get(key)?.add(event.sessionFile);

    const family = modelFamily(event.model);
    const dayIdx = Math.floor((event.tsMs - window.fromMs) / DAY_MS);
    if (dayIdx >= 0 && dayIdx < window.days) {
      const current = proj.dailyCostUsd[dayIdx] ?? 0;
      proj.dailyCostUsd[dayIdx] = current + cost;
      const familyArr = proj.dailyByFamily[family];
      familyArr[dayIdx] = (familyArr[dayIdx] ?? 0) + event.outputTokens;
    }

    const sessionLastTs = lastTsBySession.get(key);
    if (sessionLastTs !== undefined) {
      const prev = sessionLastTs.get(event.sessionFile);
      if (prev !== undefined) {
        const gap = event.tsMs - prev;
        if (gap > 0 && gap <= ACTIVE_GAP_MS) proj.activeMs += gap;
      }
      sessionLastTs.set(event.sessionFile, event.tsMs);
    }
  }

  for (const proj of byProject.values()) {
    const sessions = sessionsPerProject.get(proj.name);
    if (sessions !== undefined) proj.sessions = sessions.size;
    // Tail credit: every distinct session gets a TAIL_MS of activity so
    // singletons (gap-less sessions) read as ~1min.
    if (sessions !== undefined && sessions.size > 0) proj.activeMs += sessions.size * TAIL_MS;
    proj.outputPerLine = proj.linesAdded > 0 ? proj.outputTokens / proj.linesAdded : 0;
  }

  return {
    days: window.days,
    fromMs: window.fromMs,
    toMs: window.toMs,
    projects: [...byProject.values()].sort((a, b) => b.costUsd - a.costUsd),
  };
}
