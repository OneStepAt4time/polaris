<!--
  Polaris PR template — every field below is required.
  CI rejects PRs that don't fill these fields.
  Read CLAUDE.md and CHARTER.md before opening this PR.
-->

## Summary

<!-- 1-2 sentences: what changed and why. Focus on the "why". -->

## Charter alignment (mandatory — CI greps for this)

**CHARTER.md section: §___**

<!--
  Cite the SPECIFIC section that authorizes this change (e.g., "§3 IN scope: data ingest").
  If you can't cite a section, this PR should not exist.
  Open a needs-human issue instead.
-->

## Anti-Aegis checklist (all must be checked)

- [ ] **No new abstractions for <2 implementations.** I am not introducing any `interface`, `*Factory`, `*Registry`, `*Adapter`, `*Provider`, or `*Strategy` that has only 1 concrete implementation.
- [ ] **No half-wired files.** Every file I added in `src/` is imported by another file in `src/` within this PR. CI's orphan-files check should pass.
- [ ] **No scaffolding for deferred phases.** I am not pre-scaffolding for Postgres, Redis, SaaS, multi-tenant, SSO, OAuth, OpenTelemetry export, TUI, or mobile native.
- [ ] **No `TODO: later` or commented-out code.** Every line of code in this PR is either active or deleted.

## Budgets

- **LOC delta** (added − removed in `src/`): ___
- **New runtime dependencies** (count): ___ (target: 0; total ceiling 20)
- **New env vars in `src/config.ts`**: ___ (each one needs a `// why:` one-liner; total ceiling 12)

## Tests

- [ ] Unit tests added/updated for changed `src/metrics/`, `src/ingest/`, `src/rules/` code.
- [ ] Integration test added if a route or DB schema changed.
- [ ] No tests skipped (`it.skip`, `describe.skip`, `xit`). If skipped, link the tracking issue.

## Verification (concrete reproducible steps)

Paste the EXACT commands or browser actions you ran to verify this works.

```bash
# example:
# npm run dev &
# curl -X POST localhost:3000/v1/ping/test -H "Authorization: Bearer test123"
# expected: 200 + event in DB
```

**Result**: <what happened, what you observed>

## Issue

Closes #___

## Reviewer notes

<!--
  Anything surprising? Skipped a test? Made a judgment call worth flagging?
  This is also where you defend any anti-Aegis checkbox you DIDN'T tick.
-->
