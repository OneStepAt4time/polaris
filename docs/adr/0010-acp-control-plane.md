# ADR-0010: ACP enters IN scope — Polaris becomes a lean control plane

- **Status**: Accepted
- **Date**: 2026-05-18
- **Charter ref**: §2 Vision, §3 Scope, §9 Roadmap (this ADR triggers their rewrite)

## Context

When Polaris was founded (2026-05-17) it was positioned as a **read-only observatory**: consume Claude Code JSONL session files, surface metrics, emit notifications. CHARTER §15 explicitly said "Polaris non bridgea Claude Code, ne legge i JSONL", and the OUT scope deferred multi-agent + control-plane concerns.

ADR-0008 deferred multi-agent support to v2 on the grounds that v1 should hardcode a single backend (Claude Code) and read its JSONL output.

The day after the v0.1.0 release (2026-05-18) the maintainer clarified the strategic intent of Polaris: it must enable **other agents, tools, or humans to delegate work to Claude Code via a programmatic interface** — i.e. be the API equivalent of opening the Claude Code TUI and prompting interactively. An AI agent must be able to "be a vibe coder" through Polaris exactly as a human would in the TUI.

This use case requires:

1. **Multi-turn conversation** within a session: send prompt → receive streamed response → send next prompt.
2. **Approval handshake**: when the agent wants to run a privileged tool, it asks; the caller responds yes/no; the session continues.
3. **Session resume**: open a session, disconnect, reconnect later, continue where left off.
4. **Stream of structured events**: tool_use, tool_result, text deltas, errors — emitted in real time.

The naive alternative (`child_process.spawn('claude', ...)` + filesystem watcher on JSONL output) **cannot satisfy 1, 2, or 3**. JSONL is the persistence layer, not the wire protocol. There is no way to interrupt mid-tool-use with a "no, deny that" without a real session protocol.

The protocol that provides exactly these primitives is **ACP** (Agent Client Protocol), already used by Aegis through `@agentclientprotocol/claude-agent-acp`. Polaris must adopt it.

This makes Polaris a **lean control plane**, not just an observer — converging on Aegis's original ADR-0023 mission while preserving the discipline that makes Polaris's codebase tractable.

## Decision

**ACP enters IN scope. Polaris formalizes a lean control plane positioning, layered atop the v0.1.0 observatory baseline.**

Concretely:

1. CHARTER §2 Vision is rewritten from "observatory" to "lean control plane + observatory".
2. CHARTER §3 IN scope adds: ACP runtime, session lifecycle API, approval workflow, SSE event stream.
3. CHARTER §3 OUT scope explicitly preserves the items below (anti-Aegis hard line; see "Trap exclusions" table) but lifts the implicit "no ACP" stance that came from §15.
4. CHARTER §9 Roadmap is rewritten:
   - **v0.1.0 ✅** — observatory baseline (M0 complete)
   - **v0.2.0** — JSONL file watcher (passive ingest completion; complements ACP for sessions started outside Polaris)
   - **v0.3.0** — ACP-A: client wrapper + spawner (~200 LOC src/)
   - **v0.4.0** — ACP-B: session manager + lifecycle routes (~200 LOC src/)
   - **v0.5.0** — ACP-C: approval workflow + SSE event stream (~200 LOC src/) — **feature parity with Aegis's original ADR-0023 mission**
   - **v1.0.0** — stabilization; Aegis archive decision

### Trap exclusions (absolute, do not relax)

ACP adoption does NOT relax the discipline that distinguishes Polaris from Aegis. The following Aegis pathologies remain explicitly forbidden:

| Aegis pathology (1175 LOC `AcpBackend`) | Polaris stance |
|---|---|
| Single god-object handling session lifecycle + approvals + driver control + pause + restart + concurrent prompts | 4 separate files in `src/acp/`, each ≤200 LOC |
| Driver control (claim / release / transfer of session ownership across instances) | Out of scope, forever |
| Pause / resume intervention mid-session | Out of scope, forever (caller cancels and recreates) |
| Restart backoff exponential | Out of scope (child process crash = session dies, caller retries) |
| Multi-instance coordination via Redis | Out of scope (single-process state, SQLite for persistence) |
| Pluggable session storage (Memory + Postgres profiles) | Out of scope (SQLite only per ADR-0002) |
| `AgentAdapter` interface for a single implementation | Out of scope until 2nd backend exists per ADR-0005 / ADR-0008 |
| Approval persistence across server restart | Out of scope (in-memory; restart expires pending approvals, caller retries) |

## Consequences

**Gains**
- Polaris becomes a **delegation runtime**: AI agents, tools, and humans can use it as the channel to interact with Claude Code (and future agents) in the same multi-turn, approval-gated way the TUI works.
- The mission converges with Aegis's original ADR-0023 mission, but executed under Polaris's discipline (ADR-0005, ADR-0006, the layered defense).
- Multi-agent expansion (ADR-0008 deferral) becomes a natural next step once the ACP layer is in place: each backend is its own ACP-speaking wrapper.

**Trade-offs**
- CHARTER positioning shifts. README and external docs updated alongside this ADR.
- `@agentclientprotocol/claude-agent-acp` becomes a runtime-critical dependency. Version pinned; bumps in dedicated PRs with regression tests.
- LOC pressure: current 934 / 8000; ACP work adds ~600 LOC; v0.5.0 lands around 1500-1600 src/. Still well within ceiling but tracked.
- Aegis's parallel existence becomes finite: when Polaris reaches feature parity (v0.5) and stability (v1.0), Aegis becomes archivable. The maintainer's 24/7 agent team on Aegis transitions to Polaris gradually.

**Risks accepted**
- We may recreate Aegis's trap. **Mitigations**: the explicit NO-list above; ADR-0005 (no premature abstractions); ADR-0006 (8000 LOC ceiling); the layered defense established in PR #1 and now five releases of discipline.
- Anthropic may evolve ACP incompatibly. We pin the `claude-agent-acp` version; bump only in dedicated PRs with regression tests against fixtures.

## Reversibility

This ADR cannot be cleanly reverted once shipped. Once Polaris is the delegation channel for other agents and tools, removing ACP breaks those integrations.

Escape path: write ADR-NNNN superseding this one with concrete evidence (e.g., "Anthropic stopped publishing claude-agent-acp" or "ACP fundamentally cannot serve the use case we discovered"). Cost: re-position Polaris back to observatory-only, deprecate v0.3+ endpoints with a 6-month migration window.

## Relation to other ADRs

- **Refines ADR-0003** (Astro static + Fastify): the UI layer stays static; ACP lives in the API layer (Fastify), exposed via SSE for streaming events.
- **Refines ADR-0008** (multi-agent deferred): the deferral remains TRUE. v0.3-v0.5 hardcode Claude Code via ACP. The `AgentAdapter` extraction waits until a 2nd backend (Cursor / Codex CLI / Gemini CLI) has a real user.
- **Reaffirms ADR-0005** (no abstractions before 2 impls): no `AgentAdapter` in v0.3-v0.5; single concrete ACP wrapper.
- **Reaffirms ADR-0006** (8000 LOC ceiling): ACP work fits with headroom remaining.
- **Reaffirms ADR-0007** (JSONL dedup): retained as the passive-ingest path; the v0.2 file watcher completes its operational integration. ACP sessions and watched JSONL converge in the same `events` table.
