# ADR-0008: Multi-agent adapter pattern DEFERRED to v2

- **Status**: Accepted
- **Date**: 2026-05-17
- **Charter ref**: §3 OUT scope (multi-agent in v1), §9 M2 roadmap

## Context

Polaris's strategic value is broader than Claude Code. The same observability + multi-channel notification pattern applies to:

- **Cursor** — stores session data in SQLite + per-workspace directories with a different schema.
- **Codex CLI** — JSONL with different field names than Claude Code.
- **Aider** — chat log files in a third format.
- **Continue.dev** — VS Code extension with its own data store.
- **Gemini CLI** — different again.

The natural abstraction is an `AgentAdapter` interface that:
- Discovers sessions for the agent type on disk (or via API).
- Parses agent-specific session data into a common normalized event format.
- Applies agent-specific pricing tables.

But: ADR-0005 forbids abstractions for 1 implementation. And Aegis's experience shows premature abstractions for hypothetical second-cases produce dead-weight scaffolding (`postgres-profile.ts` and friends).

## Decision

**Polaris v1.0 hardcodes Claude Code as the only supported agent.**

- The JSONL parser is named `src/ingest/jsonl-parser.ts` — not `src/ingest/agent-adapter.ts` — to mark it as Claude-Code-specific.
- The pricing table is `pricing/anthropic.json` — not `pricing/agents/<name>.json` — for the same reason.
- The OAuth poller targets `/api/oauth/usage` on Anthropic's domain only.

**The `AgentAdapter` abstraction and the second concrete agent are deferred to v2**, conditional on all three:

1. ≥1 real external user requests another agent (Cursor is most likely first).
2. Read access to that agent's session data is feasible (file format documented or reverse-engineered without legal risk).
3. We are ready to extract the abstraction from 2 concrete implementations, not invent it in isolation.

**When v2 begins**:

1. Add the second concrete parser (e.g., `src/ingest/cursor-parser.ts`) next to the existing Claude Code one. Both concrete, no shared abstraction yet.
2. Once both are working and tested, compare them. Extract the common contract into `AgentAdapter`.
3. Refactor both concrete parsers into the abstraction in a single PR (this PR will be larger than usual; an ADR-supporting exception to the 400-LOC ceiling is anticipated).
4. Write ADR-NNNN superseding this one, with the abstraction design and the trigger that justified it.

## Consequences

**Gains**
- v1 scope is bounded: one parser, one pricing table, one set of OAuth endpoints.
- The eventual abstraction will be informed by 2 real implementations, not 1 speculative one — yielding a better contract.
- Total LOC stays under the v1 ceiling (ADR-0006).

**Trade-offs**
- v1.0 marketing language: **"Claude Code observability"**, not "AI coding agent observability". The README and CHARTER.md must use the precise phrase.
- Users on Cursor, Codex, Aider, etc., cannot use Polaris in v1. They get a clear "Claude Code only in v1, [agent X] tracked in [open issue]" message.
- The v1 → v2 transition includes a non-trivial refactoring PR. This is by design (we pay refactoring cost when it's concrete, not before).

**Risks accepted**
- A competitor may ship multi-agent observability before us. We accept that risk; we are betting on better v1 quality (CCMeter parity, multi-channel notifications, web UI) over breadth.
- The v1 parser is named generically (`jsonl-parser.ts`); readers might assume it's agent-agnostic. We mitigate via a header comment in the file referencing this ADR.

## Reversibility

To **accelerate** (build the abstraction in v1): write ADR-NNNN superseding this one. Cost: high — violates ADR-0005, requires committing to the contract without 2 real implementations to inform it.

To **stay deferred**: no action. Default.

The deferral itself is reversible procedurally and engineering-wise. The temptation to accelerate must be resisted absent the three triggers above.
