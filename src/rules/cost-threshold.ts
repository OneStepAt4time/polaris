import type { PolarisDb } from "../db.js";
import { aggregate, resolveRange } from "../metrics/aggregator.js";
import type { PricingTable } from "../metrics/pricing.js";

export interface CostThresholdConfig {
  thresholdUsd: number;
}

export interface RuleMatch {
  ruleName: string;
  dedupKey: string;
  message: string;
  /**
   * v0.35.0 — optional inline actions surfaced by channels that can render
   * them (Telegram inline_keyboard). Each action carries its display label
   * and an id the channel echoes back through callback metadata.
   */
  inlineActions?: { id: string; label: string }[];
  /**
   * v0.35.0 — opaque id the channel echoes back when the user picks an
   * action. Polaris uses it to look up the pending approval and call
   * `SessionManager.respondToApproval`.
   */
  correlationId?: string;
}

const RULE_NAME = "cost-threshold-daily";

export function checkCostThreshold(
  db: PolarisDb,
  pricing: PricingTable,
  cfg: CostThresholdConfig,
  now: number = Date.now(),
): RuleMatch | null {
  if (cfg.thresholdUsd <= 0) return null;
  const { fromMs, toMs } = resolveRange("today", now);
  const result = aggregate(db, "today", fromMs, toMs, pricing);
  if (result.totals.costUsd < cfg.thresholdUsd) return null;
  const day = new Date(now).toISOString().slice(0, 10);
  const todaySpend = result.totals.costUsd.toFixed(2);
  const threshold = cfg.thresholdUsd.toFixed(2);
  return {
    ruleName: RULE_NAME,
    dedupKey: day,
    message: `*Polaris* — daily cost threshold crossed\n\nToday's spend: \`$${todaySpend}\`\nThreshold: \`$${threshold}\`\nEvents today: \`${result.totals.events}\``,
  };
}
