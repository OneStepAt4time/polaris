import type { PolarisDb } from "../db.js";
import { aggregate, resolveRange } from "../metrics/aggregator.js";
import type { PricingTable } from "../metrics/pricing.js";
import { aggregateByProject } from "../metrics/projects.js";
import type { RuleMatch } from "./cost-threshold.js";

export interface DailySummaryConfig {
  /** UTC hour (0..23) at or after which the daily summary fires. */
  hourUtc: number;
}

const RULE_NAME = "daily-summary";
const TOP_PROJECTS = 3;

export function checkDailySummary(
  db: PolarisDb,
  pricing: PricingTable,
  cfg: DailySummaryConfig,
  now: number = Date.now(),
): RuleMatch | null {
  const nowDate = new Date(now);
  if (nowDate.getUTCHours() < cfg.hourUtc) return null;

  const { fromMs, toMs } = resolveRange("today", now);
  const totals = aggregate(db, "today", fromMs, toMs, pricing).totals;
  if (totals.events === 0) return null;

  const projects = aggregateByProject(db, pricing, 1, now)
    .projects.slice(0, TOP_PROJECTS)
    .map((p, i) => `${i + 1}. \`${p.name}\` — \`$${p.costUsd.toFixed(2)}\``)
    .join("\n");

  const day = nowDate.toISOString().slice(0, 10);
  const cost = totals.costUsd.toFixed(2);
  const out = formatTokens(totals.outputTokens);
  const projectsLine = projects ? `Top projects today:\n${projects}` : "No project data.";
  const message = `*Polaris* — daily summary (${day})\n\nCost: \`$${cost}\`\nEvents: \`${totals.events}\`\nOutput tokens: \`${out}\`\n\n${projectsLine}`;

  return { ruleName: RULE_NAME, dedupKey: day, message };
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
