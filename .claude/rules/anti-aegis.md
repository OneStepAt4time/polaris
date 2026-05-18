# Anti-Aegis rule — specific traps to avoid

> Every rule here corresponds to a specific Aegis failure documented in the 2026-05-17 audit. The cure is the inverse of the disease.

## Trap 1: "It's a good practice to abstract this"

**Aegis symptom**: `AcpSessionStore` interface with 2 implementations, but `AcpPauseInterventionStore` interface with… 1 implementation pretending to be 2. Pluggable storage that was never plugged. Channel registry for 5 channels with identical signatures.

**Rule**:
- 1 implementation = concrete function in a concrete file. Period.
- 2 implementations = consider abstraction, but only if the abstraction reduces total LOC.
- 3+ implementations = abstraction probably justified, but write an ADR explaining the boundary.

**Specifically forbidden in v1 of Polaris**:
- `interface AgentAdapter` — we hardcode Claude Code. When Cursor lands in v2, we'll extract.
- `interface NotificationChannel` — adapter functions, no interface. Each channel is `function sendX(payload): Promise<void>`.
- `interface MetricsStore` — there is one store (SQLite). Touch it directly.
- Any `*Factory`, `*Registry`, `*Provider`, `*Strategy` for v1 features.

## Trap 2: "I'll wire it later"

**Aegis symptom**: `src/services/acp/postgres-profile.ts` — 61 lines of wiring, never instantiated, no env var to switch it on. Stayed dead for months.

**Rule**:
- Every new file in `src/` must be imported by another file in `src/` within the same PR.
- Every new public export must be referenced by name somewhere in `src/` within the same PR.
- CI runs an "orphan files" check.

## Trap 3: "Let's prepare for the next phase"

**Aegis symptom**: Phase 4 (enterprise GA) had 18 deferred issues, 9 of which were partially scaffolded in code. Year of "preparing" without any v1 user.

**Rule**:
- Build for the current milestone only (M0 / M1 / M2).
- "v2 will need X" is not a reason to add X to v1.
- The v1 → v2 transition is allowed to be ugly. It will be ugly. Plan for that, not against it.

## Trap 4: "Tests pass, ship it"

**Aegis symptom**: 302 test files, but 8 hard test failures on Windows, dashboard 404 (#3609), MCP wiring bug (#3614). Tests passed; product didn't work.

**Rule**:
- Every PR body must include a "Verification" section with reproducible end-to-end steps (curl, browser, shell).
- For UI changes: a screenshot or recorded interaction.
- For ingest changes: the JSONL fixture used + the expected output.
- Tests are necessary, not sufficient.

## Trap 5: "Just one more env var"

**Aegis symptom**: 46 env vars in `src/config.ts`, ~10 referenced exactly once.

**Rule**:
- Each new env var requires a `// why:` one-liner above its declaration explaining who needs to override it.
- Hard ceiling: 12 total. If you need a 13th: consolidate two existing ones first.

## Trap 6: "We need this dependency"

**Aegis symptom**: OpenTelemetry stack (7 packages) wired into config but used by 1 file. 13 transitive imports for ~50 LOC of actual telemetry.

**Rule**:
- Adding a runtime dependency: PR body must answer (1) what does it do for us, (2) how much of it do we use, (3) what would removing it cost.
- Hard ceiling: 20 runtime deps. Approaching 18 = audit before adding.
- Prefer the standard library or `undici` (already transitive) before adding HTTP clients.

## Trap 7: "Just one more feature in the dashboard"

**Aegis symptom**: 366 dashboard files (analytics, cost tracking, routines, billing, mobile, accessibility tour). 1.9× the backend codebase. Targeted SaaS use cases that contradicted self-hosted positioning.

**Rule**:
- Polaris UI scope is FROZEN to CCMeter parity feature set (CHARTER.md §3 IN scope).
- New UI feature outside that set: refuse, propose CHARTER amendment.

## Trap 8: "I'll squash this big diff into one commit"

**Aegis symptom**: Some PRs touched 20+ unrelated files. 5 concerns bundled. Reviews became sampling.

**Rule**:
- 1 PR = 1 concern. If the diff touches multiple unrelated areas, split.
- 400 LOC ceiling per PR forces this discipline.
- "Drive-by fix on the way" deserves its own PR.

## Trap 9: Documentation drifting from code

**Aegis symptom**: ADR-0023 said "bridge not orchestrator" — but `src/pipeline.ts` shipped multi-stage orchestration.

**Rule**:
- If you change `src/` in a way that touches an architectural boundary, update the relevant ADR or open a new one in the same PR.
- If your ADR contradicts the code, the code is wrong (revert) or the ADR is wrong (rewrite). Not both.

## Trap 10: "I'll just bypass the rule this once"

**Aegis symptom**: small bypasses that compounded.

**Rule**:
- There is no bypass path. If a rule blocks you, write an ADR. The ADR can change the rule. The rule cannot be skipped.
- If you find yourself rationalizing ("this is different", "this is exceptional"), stop. Open `needs-human`.
