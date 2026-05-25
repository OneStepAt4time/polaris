import type { Channel } from "../channels/channel.js";
import type { PolarisDb } from "../db.js";
import type { PricingTable } from "../metrics/pricing.js";
import { type ApprovalNeededConfig, checkApprovalNeeded } from "./approval-needed.js";
import { type CostThresholdConfig, type RuleMatch, checkCostThreshold } from "./cost-threshold.js";
import { type DailySummaryConfig, checkDailySummary } from "./daily-summary.js";
import { type RateLimitNearConfig, checkRateLimitNear } from "./rate-limit-near.js";
import { type SessionFailedConfig, checkSessionFailed } from "./session-failed.js";

export interface EngineConfig {
  costThreshold: CostThresholdConfig | null;
  rateLimitNear?: RateLimitNearConfig | null;
  dailySummary?: DailySummaryConfig | null;
  sessionFailed?: SessionFailedConfig | null;
  /** v0.27.0: notify when any session has a pending tool-permission approval. */
  approvalNeeded?: ApprovalNeededConfig | null;
  channels: Channel[];
  intervalMs: number;
}

export interface EngineHandle {
  tick(): Promise<void>;
  stop(): void;
}

export type EngineLog = (msg: string) => void;

const noopLog: EngineLog = () => {};

export function evaluateRules(
  db: PolarisDb,
  pricing: PricingTable,
  cfg: EngineConfig,
): RuleMatch[] {
  const matches: RuleMatch[] = [];
  if (cfg.costThreshold !== null) {
    const m = checkCostThreshold(db, pricing, cfg.costThreshold);
    if (m !== null) matches.push(m);
  }
  if (cfg.rateLimitNear !== null && cfg.rateLimitNear !== undefined) {
    matches.push(...checkRateLimitNear(db, cfg.rateLimitNear));
  }
  if (cfg.dailySummary !== null && cfg.dailySummary !== undefined) {
    const m = checkDailySummary(db, pricing, cfg.dailySummary);
    if (m !== null) matches.push(m);
  }
  if (cfg.sessionFailed !== null && cfg.sessionFailed !== undefined) {
    matches.push(...checkSessionFailed(cfg.sessionFailed));
  }
  if (cfg.approvalNeeded !== null && cfg.approvalNeeded !== undefined) {
    matches.push(...checkApprovalNeeded(cfg.approvalNeeded));
  }
  return matches;
}

interface DispatchSummary {
  ok: boolean;
  successes: string[];
  failures: { channel: string; error: string }[];
}

async function dispatch(match: RuleMatch, channels: Channel[]): Promise<DispatchSummary> {
  if (channels.length === 0) {
    return { ok: false, successes: [], failures: [{ channel: "(none)", error: "no channels" }] };
  }
  const results = await Promise.all(
    channels.map(async (c) => ({ name: c.name, result: await c.send(match.message) })),
  );
  const summary: DispatchSummary = { ok: false, successes: [], failures: [] };
  for (const r of results) {
    if (r.result.ok) summary.successes.push(r.name);
    else summary.failures.push({ channel: r.name, error: r.result.error ?? "unknown" });
  }
  // Mark notified if at least one channel delivered. A partial failure is still
  // "delivered" — the user got the alert somewhere. A total failure leaves
  // wasNotified=false so the next tick retries.
  summary.ok = summary.successes.length > 0;
  return summary;
}

export function startEngine(
  db: PolarisDb,
  pricing: PricingTable,
  cfg: EngineConfig,
  log: EngineLog = noopLog,
): EngineHandle {
  const tick = async (): Promise<void> => {
    const matches = evaluateRules(db, pricing, cfg);
    for (const match of matches) {
      if (db.wasNotified(match.ruleName, match.dedupKey)) continue;
      const summary = await dispatch(match, cfg.channels);
      if (summary.ok) {
        db.markNotified(match.ruleName, match.dedupKey, Date.now());
        log(
          `[rules] sent ${match.ruleName} (${match.dedupKey}) via ${summary.successes.join(",")}`,
        );
        for (const failure of summary.failures) {
          log(`[rules] ${match.ruleName} partial failure on ${failure.channel}: ${failure.error}`);
        }
      } else {
        const errors = summary.failures.map((f) => `${f.channel}=${f.error}`).join("; ");
        log(`[rules] failed ${match.ruleName}: ${errors}`);
      }
    }
  };
  const handle = setInterval(() => {
    tick().catch((e) => log(`[rules] tick error: ${e instanceof Error ? e.message : String(e)}`));
  }, cfg.intervalMs);
  return {
    tick,
    stop: () => clearInterval(handle),
  };
}
