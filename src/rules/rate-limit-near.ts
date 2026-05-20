import type { PolarisDb } from "../db.js";
import type { RuleMatch } from "./cost-threshold.js";

export interface RateLimitNearConfig {
  thresholdPct: number;
}

const RULE_PREFIX = "rate-limit-near";

interface WindowSample {
  key: string;
  utilization: number;
}

function extractWindows(payload: unknown): WindowSample[] {
  if (payload === null || typeof payload !== "object") return [];
  const out: WindowSample[] = [];
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (value === null || typeof value !== "object") continue;
    const u = (value as Record<string, unknown>).utilization;
    const num = typeof u === "number" ? u : typeof u === "string" ? Number(u) : Number.NaN;
    if (!Number.isFinite(num)) continue;
    const normalized = num > 1 ? num : num * 100;
    out.push({ key, utilization: normalized });
  }
  return out;
}

export function checkRateLimitNear(
  db: PolarisDb,
  cfg: RateLimitNearConfig,
  now: number = Date.now(),
): RuleMatch[] {
  if (cfg.thresholdPct <= 0) return [];
  const sample = db.getLatestRateLimitSample();
  if (sample === null || sample.rawJson === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(sample.rawJson);
  } catch {
    return [];
  }
  const day = new Date(now).toISOString().slice(0, 10);
  const matches: RuleMatch[] = [];
  for (const window of extractWindows(parsed)) {
    if (window.utilization < cfg.thresholdPct) continue;
    const pct = window.utilization.toFixed(0);
    const threshold = cfg.thresholdPct.toFixed(0);
    matches.push({
      ruleName: `${RULE_PREFIX}:${window.key}`,
      dedupKey: day,
      message: `*Polaris* — rate limit near\n\nWindow: \`${window.key}\`\nUtilization: \`${pct}%\`\nThreshold: \`${threshold}%\``,
    });
  }
  return matches;
}
