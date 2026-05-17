# ADR-0007: JSONL dedup strategy — by `requestId`

- **Status**: Accepted
- **Date**: 2026-05-17
- **Charter ref**: §3 IN scope (JSONL parser), §15 (CCMeter reference)

## Context

Claude Code persists session data as JSONL files in `~/.claude/projects/**/*.jsonl`. The same API response can appear multiple times across these files because:

1. **Streaming chunks**: a single response is logged once per streaming chunk during the live session.
2. **Sub-agent transcripts**: sub-agents (Task tool invocations, agent-spawned subagents) inherit and re-emit the parent transcript.
3. **`/compact` retries**: when a user runs `/compact` to compress conversation, the prior responses are re-emitted into the new session log.

Naïve "sum every event" parsers produce token totals **2–3× higher than Anthropic's actual billing**. This was demonstrated and solved by CCMeter (see `hmenzagh/CCMeter` → `src/data/parser.rs`); Anthropic's billing matches dedup-by-`requestId`, not the raw sum.

`requestId` is Anthropic's billing unit: one request = one invoice line. Every duplicate log of the same request shares the same `requestId`.

## Decision

**Polaris deduplicates JSONL events by `requestId` using the same algorithm as CCMeter.**

Algorithm (in `src/ingest/jsonl-parser.ts`):

1. **Stream** all JSONL files for a project. Do not load full files into memory.
2. **Group** events by `requestId`.
3. **Pick the canonical record** within each group: the most complete log (fewest null fields, longest content arrays). Ties broken by earliest timestamp.
4. **Re-emit** the canonical record as per-chunk delta events, preserving real timestamps so the minute-level timeline reflects actual activity, not just the final log line.
5. **Mark non-canonical duplicates** as zero-billing "ghost" markers so `active_minutes` and code-activity metrics stay accurate even when the canonical log is a terminal snapshot.
6. **User-side patches** (`Edit` / `Write` tool acceptances by the user) are deduplicated by line `uuid` for the same reason — a `/compact` retry re-emits the patch metadata.

Result: Polaris token totals match Anthropic's billing within ±1% on any given dataset (verified by running CCMeter and Polaris over the same `~/.claude/projects/`).

## Consequences

**Gains**
- Cost figures are trustworthy and reconcilable with Anthropic invoices.
- Activity timeline reflects real work, not log inflation.
- The ±1% parity with CCMeter is mechanically testable (M0 exit criterion).

**Trade-offs**
- "Most complete" picking is a heuristic; new edge cases (e.g., a new Claude Code retry mode) may require iteration.
- Sub-agent ghost markers are an extra concept to explain in user docs.
- Schema-level dedup means a Claude Code JSONL format change can break us; we mitigate via versioned fixtures (5 fixtures specified in `.claude/rules/testing.md`).

**Risks accepted**
- Anthropic introduces a new dedup edge case → we add a fixture, fix the parser, ship a patch release. This maintenance burden is inherent to consuming a third-party log format and is acceptable.
- A user's Claude Code is configured with a non-standard project path → our discovery (scan `~/.claude/`, `~/.config/claude/`, etc., same as CCMeter) misses it. They configure `POLARIS_JSONL_DIR` explicitly. Documented.

## Reversibility

This is the **core algorithm of Polaris's value** — replacing it changes every metric. Procedural cost to revoke: write ADR-NNNN. Engineering cost: re-aggregate all historical data (or invalidate historical metrics) on the next launch.

In theory reversible; in practice sticky-by-data-lock-in.

## Required test fixtures

`src/__tests__/fixtures/jsonl/` must contain (anonymized) examples of:

- `single-session.jsonl` — happy path, one request, one log line per chunk.
- `compact-retry.jsonl` — `/compact` retry producing duplicated `requestId` across two sessions.
- `sub-agent.jsonl` — sub-agent transcript duplicating parent events.
- `mixed-models.jsonl` — Opus + Sonnet + Haiku in same session.
- `corrupted.jsonl` — malformed lines interleaved with valid ones; parser must skip not crash.

`vitest` assertions: dedup produces known-expected token and cost totals per fixture.
