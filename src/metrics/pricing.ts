import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const PriceLevelsSchema = z.object({
  input: z.number().positive(),
  output: z.number().positive(),
  cacheRead: z.number().nonnegative(),
});

const PricingFileSchema = z.object({
  patterns: z.array(PriceLevelsSchema.extend({ match: z.string().min(1) })),
  fallback: PriceLevelsSchema,
});

export type PriceLevels = z.infer<typeof PriceLevelsSchema>;
export type PricingTable = z.infer<typeof PricingFileSchema>;

export interface CostInput {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  rawCostUsd: number | null;
}

const TOKENS_PER_MILLION = 1_000_000;

let cachedTable: PricingTable | null = null;

export function loadPricing(jsonPath?: string): PricingTable {
  if (cachedTable !== null && jsonPath === undefined) return cachedTable;
  const here = dirname(fileURLToPath(import.meta.url));
  const path = jsonPath ?? resolve(here, "..", "..", "pricing", "anthropic.json");
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  const parsed = PricingFileSchema.parse(raw);
  if (jsonPath === undefined) cachedTable = parsed;
  return parsed;
}

export function priceLevelsFor(model: string, table: PricingTable): PriceLevels {
  for (const pattern of table.patterns) {
    if (model.includes(pattern.match)) {
      return { input: pattern.input, output: pattern.output, cacheRead: pattern.cacheRead };
    }
  }
  return table.fallback;
}

/**
 * Cost in USD for one event. Prefers `rawCostUsd` (Anthropic's authoritative
 * billed amount, when emitted by Claude Code) and falls back to a computed
 * approximation when null (Pro-plan logs omit `costUSD`).
 *
 * Cache creation tokens are priced as input — an approximation that slightly
 * over-estimates vs. Anthropic's actual 1.25x input rate. Conservative for
 * budget alerts. A future ADR may add a `cacheCreate` field to the pricing
 * JSON if precision becomes a user-visible concern.
 */
export function computeCost(event: CostInput, table: PricingTable): number {
  if (event.rawCostUsd !== null) return event.rawCostUsd;
  const p = priceLevelsFor(event.model, table);
  return (
    (event.inputTokens * p.input) / TOKENS_PER_MILLION +
    (event.outputTokens * p.output) / TOKENS_PER_MILLION +
    (event.cacheReadTokens * p.cacheRead) / TOKENS_PER_MILLION +
    (event.cacheCreationTokens * p.input) / TOKENS_PER_MILLION
  );
}
