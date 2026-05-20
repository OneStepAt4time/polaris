import {
  type ChannelResult,
  type TelegramConfig,
  sendTelegramMessage,
} from "../channels/telegram.js";
import type { PolarisDb } from "../db.js";
import type { PricingTable } from "../metrics/pricing.js";
import { type CostThresholdConfig, type RuleMatch, checkCostThreshold } from "./cost-threshold.js";
import { type RateLimitNearConfig, checkRateLimitNear } from "./rate-limit-near.js";

export interface EngineConfig {
  costThreshold: CostThresholdConfig | null;
  rateLimitNear?: RateLimitNearConfig | null;
  telegram: TelegramConfig | null;
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
  return matches;
}

async function dispatch(match: RuleMatch, telegram: TelegramConfig | null): Promise<ChannelResult> {
  if (telegram !== null) return sendTelegramMessage(telegram, match.message);
  return { ok: false, error: "no notification channel configured" };
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
      const sent = await dispatch(match, cfg.telegram);
      if (sent.ok) {
        db.markNotified(match.ruleName, match.dedupKey, Date.now());
        log(`[rules] sent ${match.ruleName} (${match.dedupKey})`);
      } else {
        log(`[rules] failed ${match.ruleName}: ${sent.error ?? "unknown"}`);
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
