# Architectural Decision Records (ADRs)

This directory holds the architectural decision records for Polaris. Each ADR captures the context, decision, and consequences of a load-bearing choice — large enough to be wrong about, small enough to fit on one page.

## When to write an ADR

Open `.github/ISSUE_TEMPLATE/adr-needed.yml` if you want to:

- Add or remove a layer in the architecture.
- Change a CHARTER.md decision.
- Introduce a new external dependency that is load-bearing.
- Adopt a new pattern that will be applied repeatedly.
- Raise (or lower) a budget ceiling.

Do **not** introduce any of the above in a regular PR without an ADR first. See `.claude/rules/scope.md` and `CLAUDE.md`.

## Format

Each ADR follows this skeleton (target: 1 page max):

```
# ADR-NNNN: Title (imperative, brief)

- Status: Proposed | Accepted | Superseded by ADR-MMMM
- Date: YYYY-MM-DD
- Charter ref: §N

## Context
Why is this question being asked? What's at stake?

## Decision
What did we decide? Concrete and unambiguous.

## Consequences
What does this enable? What do we give up? What risks remain?

## Reversibility
How hard would it be to undo? Cheap / moderate / sticky.
```

## ADRs in force

| # | Title | Status |
|---|---|---|
| [0001](./0001-self-hosted-only.md) | Self-hosted only, no SaaS in v1.0/v2.0 | Accepted |
| [0002](./0002-sqlite-storage.md) | SQLite as primary (and only) storage in v1.0 | Accepted |
| [0003](./0003-no-spa.md) | Server-rendered HTML (Astro) + selective client islands | Accepted |
| [0004](./0004-single-user-mvp.md) | Single-user MVP, multi-user defer to v2 | Accepted |
| [0005](./0005-no-premature-abstractions.md) | No abstractions before 2 implementations exist | Accepted |
| [0006](./0006-loc-ceiling.md) | 8000 LOC ceiling for src/ at v1.0 | Accepted |
| [0007](./0007-jsonl-dedup.md) | JSONL dedup strategy — by `requestId` | Accepted |
| [0008](./0008-multi-agent-deferred.md) | Multi-agent adapter pattern DEFERRED to v2 | Accepted (refined by 0010) |
| [0009](./0009-astro-static-build.md) | Astro static build, Fastify serves the artifact | Accepted (refines 0003) |
| [0010](./0010-acp-control-plane.md) | ACP enters IN scope — Polaris becomes a lean control plane | Accepted (refines 0003, 0008; reaffirms 0005, 0006, 0007) |
| [0011](./0011-native-arm-runner-multi-arch.md) | Multi-arch Docker builds on native runners | Accepted |

## Superseding an ADR

1. Write a new ADR with a higher number explaining the change.
2. In the new ADR's `Status` line: `Supersedes ADR-NNNN`.
3. In the old ADR's `Status` line: `Superseded by ADR-MMMM` (keep the rest of the file as historical record).
4. Update the index above. The old ADR is moved to a "Superseded" section.

Old ADRs are never deleted — they are the audit trail of how we got here.
