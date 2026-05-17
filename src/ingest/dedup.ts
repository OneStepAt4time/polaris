import type { NormalizedEvent } from "./jsonl-parser.js";

export interface DedupResult {
  kept: NormalizedEvent[];
  duplicates: number;
}

/**
 * Dedup by `requestId` (Anthropic billing unit — see ADR-0007).
 *
 * Within a requestId group:
 *  - Pick the canonical event as the EARLIEST by timestamp (ties broken by sessionFile lexicographic order).
 *  - Discard others.
 *
 * This is ADR-0007 steps 1-3. Steps 4-5 (per-chunk delta + ghost markers
 * for active_minutes accuracy) are deferred until the active-time
 * metric lands; for token totals (the M1 acceptance criterion) the
 * canonical pick alone is sufficient.
 */
export function dedupByRequestId(events: NormalizedEvent[]): DedupResult {
  const byRequest = new Map<string, NormalizedEvent>();
  let duplicates = 0;

  for (const event of events) {
    const existing = byRequest.get(event.requestId);
    if (existing === undefined) {
      byRequest.set(event.requestId, event);
      continue;
    }
    duplicates += 1;
    if (isMoreCanonical(event, existing)) {
      byRequest.set(event.requestId, event);
    }
  }

  return { kept: [...byRequest.values()], duplicates };
}

function isMoreCanonical(candidate: NormalizedEvent, current: NormalizedEvent): boolean {
  if (candidate.tsMs < current.tsMs) return true;
  if (candidate.tsMs > current.tsMs) return false;
  return candidate.sessionFile < current.sessionFile;
}
