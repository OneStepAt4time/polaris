# ADR-0006: 8000 LOC ceiling for src/ at v1.0

- **Status**: Accepted
- **Date**: 2026-05-17
- **Charter ref**: §3 IN scope ceiling target, `.claude/rules/budgets.md`

## Context

Aegis had no LOC ceiling. The codebase grew from a pitched "Fastify bridge" to **189 backend files plus 366 dashboard files**. By the time the over-engineering became visible to the maintainer, it was entrenched: removing dead code required arguing with the historical justification of each addition.

LOC is an imperfect metric:
- Not all lines have equal complexity.
- Concise code can be denser than verbose code with equivalent behavior.
- Generated code, comments, and docstrings count differently to different tools.

But LOC correlates well with the things we care about:
- Cognitive overhead per change.
- Time-to-onboard for a new contributor.
- Test surface area.
- Bug surface area.
- Build / lint / test runtime.

Most importantly, a ceiling is a **forcing function**: it makes "where does this fit, and what would we remove to add it" a constant question, rather than an afterthought encountered too late.

## Decision

**Polaris v1.0 ships with no more than 8000 total LOC in `src/` (excluding `src/__tests__/` and generated files).**

Counted via `cloc src/ --exclude-dir=__tests__ --not-match-f='.*\.generated\..*'` or equivalent.

Additional limits (see `.claude/rules/budgets.md`):
- **Per-PR source LOC delta**: 400 in `src/`. CI-enforced via `size-check.yml`.
- **Soft alert** at 7500: the next PR touching the affected area must include a refactoring component.

When the ceiling is approached (≥7500):
1. Audit hot spots: `cloc src/* --by-file | sort -k5 -nr | head`.
2. Identify simplifications: dead code, redundant abstractions, fat utility files.
3. Open a refactoring PR before any new feature PR.

When the ceiling is genuinely insufficient for v1.0 scope:
1. Open an ADR proposal (`.github/ISSUE_TEMPLATE/adr-needed.yml`).
2. Provide evidence: which concrete v1 feature requires the increase, what was attempted first within the ceiling, why it didn't fit.
3. Maintainer reviews as any other architectural change.

**No silent ceiling raises.** Bumping from 8000 to 10000 "because we need it" is exactly how Aegis grew unbounded.

## Consequences

**Gains**
- Continuous pressure against scope creep at the most concrete level: lines added.
- Forces "what would we remove to add this" thinking.
- Onboarding cost is bounded: 8000 LOC is roughly 2 days of careful reading.
- The ceiling is a public, auditable, version-controlled fact — not a guideline.

**Trade-offs**
- May force suboptimal compactness (e.g., a long function vs. extracting a helper).
- LOC is gameable — one-line ternary chains can hide real complexity. We accept this and rely on code review + the abstraction discipline (ADR-0005) to catch perverse compactness.
- v2 will need a new ceiling, decided when v2 work begins.

**Risks accepted**
- We may need to raise the ceiling. The process (ADR + concrete evidence) is the safeguard, not the number itself.
- The CI gates that enforce this (`loc-budget.yml`, `size-check.yml`) come online once `package.json` exists (M0 work).

## Reversibility

Cost to raise: **procedural** (ADR + evidence). Cost to lower: **also procedural** (lowering forces a refactoring sprint to comply).

Easy to change with ceremony; impossible to skip silently. By design.
