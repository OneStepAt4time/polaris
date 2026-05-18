# Polaris Development Process

> The complete, auditable development workflow for Polaris.
> AI agents and humans both follow this. Every step has a reason traceable to an Aegis failure.

---

## Why this process exists

Aegis failed under three pressures:
1. **Scope drift** — features piled on without checking the original mandate.
2. **Premature abstraction** — interfaces, factories, pluggable stores for features that had only 1 implementation.
3. **Half-wired scaffolding** — Postgres profile, Redis coordination, OTel — code without behavior, mutating into permanent dead weight.

This process is **layered defense**. Each layer catches what the previous missed. Even if 5 layers fail, layer 6 will block the bad PR.

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: CHARTER.md       — single source of truth         │
│  Layer 2: CLAUDE.md        — agent rules (auto-loaded)       │
│  Layer 3: .claude/rules/   — scoped rules (on-demand)        │
│  Layer 4: Issue templates  — force scope citation at intake  │
│  Layer 5: PR template      — force checklist + verification  │
│  Layer 6: CI workflows     — hard block on rule violations   │
│  Layer 7: Periodic audits  — catch drift over time           │
│  Layer 8: ADR process      — major decisions need ceremony   │
└─────────────────────────────────────────────────────────────┘
```

---

## The 7 Phases

### Phase 0 — Before you touch code

1. **Read CHARTER.md** (specifically §3 IN scope, §13 refused list).
2. **Read CLAUDE.md** (auto-loaded by Claude Code; manually loaded by other agents).
3. **Find or create an issue.**
   - Use `.github/ISSUE_TEMPLATE/feature.yml` or `bug.yml` or `adr-needed.yml`.
   - **The issue body MUST cite the CHARTER.md section authorizing the work.**
   - If you can't cite a section: open `adr-needed.yml` instead. Do NOT start work.
4. **Wait for maintainer.** Issues need `ready-for-work` label before work begins. Issues without it remain proposals.

### Phase 1 — Worktree + branch

```bash
mkdir -p .claude/worktrees
git fetch origin
git worktree add .claude/worktrees/<slug> -b feature/<slug> origin/develop
cd .claude/worktrees/<slug>
```

Worktrees keep your local edits isolated and prevent "I accidentally pushed to develop" errors.

### Phase 2 — Code with the right scoped rules loaded

| Working on... | Load |
|---|---|
| Refusing or escalating work | `.claude/rules/scope.md` |
| Tempted to add abstraction / scaffolding | `.claude/rules/anti-aegis.md` |
| Adding new env var, dep, or large code | `.claude/rules/budgets.md` |
| Writing tests | `.claude/rules/testing.md` |
| Preparing PR | `.claude/rules/prs.md` |

Commit early, commit often. Conventional Commits. See `.claude/rules/workflow.md` for full details.

### Phase 3 — Local gate (mandatory before push)

```bash
npm run gate
```

Runs: `tsc --noEmit && biome check && vitest run && npm run budget-check`. **If anything fails: fix or escalate via `needs-human` issue. Never push with a red gate.**

Then run the feature end-to-end manually:
- Start the server: `npm run dev`
- Hit the endpoint or open the UI page you changed
- Confirm it works as expected
- **Document the steps in your PR body's "Verification" section.**

### Phase 4 — PR to develop

```bash
gh pr create --base develop \
  --title "fix: <what changed>" \
  --body "$(cat <<'EOF'
[fill the template at .github/PULL_REQUEST_TEMPLATE.md]
EOF
)"
```

**CI gates that run automatically:**

| Gate | Blocks merge if... |
|---|---|
| `charter-check` | PR body doesn't cite a `CHARTER.md` section |
| `size-check` | Source diff in `src/` exceeds 400 LOC |
| `loc-budget` | Total `src/` LOC exceeds 8000 |
| `deps-budget` | Runtime deps exceed 20 |
| `env-budget` | Env vars in `src/config.ts` exceed 12 |
| `ci` (tsc, biome, vitest) | Type check, lint, or tests fail |
| `commits` | Any commit lacks Conventional Commits format |

A PR that fails any gate **cannot be merged.** Maintainers will not bypass — they will close the PR and ask you to split or rework.

### Phase 5 — Review

- Maintainer (currently solo: Emanuele) reviews.
- "Approve" requires: charter alignment confirmed, anti-Aegis checklist all green, verification steps reproducible.
- "Request changes" means come back with fixes; do not argue in comments without code.

### Phase 6 — Merge

- **Squash merge** if PR has multiple commits.
- Branch deleted automatically (GitHub setting).
- Worktree removed locally: `git worktree remove .claude/worktrees/<slug>`.
- Issue auto-closes via `Closes #N` in PR body.

### Phase 7 — Periodic audit (weekly or per-release)

Maintainer runs (will become automated):

| Audit | Action if fails |
|---|---|
| Total LOC in `src/` | If >7500: refactor PR before new features |
| Dep count | If >18: dep audit PR before new features |
| Env var count | If >10: consolidate or remove |
| Orphan files (in `src/` not reachable from entry) | Delete or wire |
| ADRs without code change | Stale ADR — supersede or delete |
| Code without ADR for architectural choices | Backfill ADR |

---

## The ADR Process

When to write an ADR:
- Adding a new layer or boundary to architecture.
- Changing a CHARTER.md decision.
- Introducing a new external dependency that's load-bearing (DB, message broker, framework).
- Adopting a new pattern that will be applied repeatedly.

ADRs live in `docs/adr/NNNN-title.md`. Format: Context / Decision / Consequences. 1 page max.

The 8 Day-1 ADRs (`docs/adr/0001` through `0008`) are listed in `CHARTER.md §10`. Write them BEFORE writing production code.

To override or supersede an existing ADR:
1. Write a new ADR explaining why.
2. Reference the old ADR as `Supersedes ADR-NNNN`.
3. The old ADR stays in the repo as historical record; do not delete.

---

## When the process gets in your way

The process is intentionally heavy at the small scale because Aegis got heavy at the large scale. If you find the process blocking legitimate work:

1. **Do NOT bypass it for one PR.** That's how every "just this once" eventually destroys the system.
2. **Do open an ADR** explaining the situation, what rule should change, and what evidence supports the change.
3. **Maintainer reviews the ADR like any other architectural change.**

The rules can change. The process for changing them cannot be skipped.

---

## Solo-mode adaptations

While the team is just the maintainer:
- Self-merge OK after CI is green.
- Reviews can be "I reviewed my own PR" with a written note.
- ADRs still require explicit writing — no "decided in my head" entries.

When a second contributor joins, self-merge is disabled by branch protection.

---

## Reference

- [CHARTER.md](../CHARTER.md) — scope, architecture, roadmap.
- [CLAUDE.md](../CLAUDE.md) — rules.
- [`.claude/rules/`](../.claude/rules/) — scoped rules.
- [`.github/`](../.github/) — templates and workflows.
- [`docs/adr/`](./adr/) — architectural decision records.
