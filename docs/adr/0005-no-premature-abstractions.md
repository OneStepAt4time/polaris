# ADR-0005: No abstractions before 2 implementations exist

- **Status**: Accepted
- **Date**: 2026-05-17
- **Charter ref**: §3 OUT scope, §13 refused list, `.claude/rules/anti-aegis.md` Trap 1

## Context

Aegis introduced abstractions speculatively. Examples:

- `AcpSessionStore` interface: 1 working implementation (`MemoryAcpSessionStore`) + 1 (`PostgresAcpSessionStore`) that was never instantiated.
- `AcpFanout` interface: `LocalAcpFanout` (114 lines) + `RedisAcpFanout` (355 lines wrapping Local) — Redis layer was thin and disconnected from the rest of the system.
- `AcpLocalStorageProfile`: 2 implementations where the Postgres one was 61 lines of wiring that never ran.
- Notification channel "registry" with 5 channels that all had identical signatures and no runtime swapping.
- A "store factory" pattern instantiated exactly once per process startup, never reconfigured.

Each abstraction added at minimum:
- One interface file
- N implementation files
- A factory or registry
- Tests for each impl + the factory
- Configuration / env vars to select implementation

Realized runtime benefit: zero. The "alternative" implementations never shipped, never ran, never were swapped at runtime.

This is the most damaging Aegis pathology because it is the most subtle. Each abstraction looked locally reasonable ("good design"); the cumulative effect was a 2-3× LOC inflation in core paths.

## Decision

**No abstraction in Polaris until at least 2 real, used, shipping implementations exist.**

Specifically:

- **No `interface I*`** for a single concrete class.
- **No `*Factory` / `*Registry` / `*Provider` / `*Strategy`** for a single product.
- **No `*Adapter`** for a single backend.
- **No "pluggable" anything** until 2 implementations are in `src/` AND used by the runtime.

When the 2nd implementation arrives:

1. Add it as a concrete sibling file to the first.
2. Open a refactoring PR that extracts the abstraction from the 2 concretes.
3. The abstraction should reduce total LOC, not increase it (if extracting makes the codebase bigger, don't extract — the duplication is fine).
4. The abstraction lives in the same file as the dominant implementation until 3+ impls justify a separate file.

**Specific applications in Polaris v1**:

| Domain | v1 approach | v2 trigger |
|---|---|---|
| Notification channels | `telegram.ts`, `slack.ts`, `discord.ts`, `webhook.ts` each a function `sendX(payload)`. No `NotificationChannel` interface. | If a 5th external channel is added (e.g., Matrix), revisit. |
| Agent runtimes | Claude Code only, hardcoded JSONL parser in `src/ingest/jsonl-parser.ts`. | When Cursor (or similar) is added in v2 → extract `AgentAdapter`. See ADR-0008. |
| Storage | Direct SQLite access in `src/db.ts`. No `MetricsStore` interface. | If multi-backend is ever required → revisit ADR-0002. |
| Rules | Each rule (`cost-threshold.ts`, `rate-limit-near.ts`, etc.) is a function. No `Rule` interface. | If runtime-loadable rules are needed (v3+), revisit. |

## Consequences

**Gains**
- Smaller codebase per feature (no interface + impl pair = single file).
- Faster reading (no interface chase chain).
- Refactoring later is concrete, scoped, and cheap (a few hours per abstraction).
- New contributors onboard faster (concrete code > generic indirection).

**Trade-offs**
- Slight duplication is acceptable and even encouraged (e.g., similar webhook signing logic in Slack and Discord — fine).
- Tests touch concrete impls. When abstraction lands, tests refactor along with it.
- Code review must catch "this looks like the start of a pattern" and defer abstraction explicitly.

**Risks accepted**
- We may "miss" the right moment to abstract. The cost of refactoring at month 3 is bounded and concrete; the cost of premature abstraction in week 1 is unbounded and compounds. We accept the former.

## Reversibility

This is a meta-decision (a rule about how we make other decisions). Procedural cost to revoke: write ADR-NNNN. Engineering cost to revoke: zero (just start abstracting). Engineering cost of decision: zero (just don't abstract).

This ADR will be cited frequently in PR reviews. Its persistence depends on consistent enforcement.
