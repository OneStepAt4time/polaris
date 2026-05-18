# CLAUDE.md — Polaris Project Instructions

> Primary rule file for Claude Code (and any other AI coding agent) working on Polaris.
> This file is loaded automatically into every Claude Code session. **Read it before doing anything.**
> Scoped rules live in `.claude/rules/` and load on demand. Full process: `docs/DEV_PROCESS.md`. Charter: `CHARTER.md`.

## Your job in one paragraph

Polaris is a **self-hosted observatory for AI coding agents** (see `CHARTER.md`). It was started after the predecessor project (Aegis) failed under over-engineering. Your single most important responsibility on this codebase: **do not repeat the Aegis mistakes**. Every "no" below is scar tissue from a specific Aegis pain point.

---

## The 8 Hard Rules (CI enforces — do not negotiate)

1. **Every change traces to a CHARTER.md section.** Cite it in the PR description (`CHARTER.md section: §3`). If you can't cite one, this change should not be a PR — open a `needs-human` issue.
2. **No abstraction without 2 real implementations.** No `interface I*` for 1 class. No `*Factory` for 1 product. No `*Registry` for 1 entry. No `*Adapter` for 1 backend. (ADR-0005)
3. **No half-wired infrastructure.** A file you add MUST be reachable from an entry point (`src/server.ts` or a route) in the SAME PR. No "we'll wire it later" — that's how `postgres-profile.ts` and Redis coordination became dead weight in Aegis.
4. **No scaffolding for deferred phases.** Postgres / Redis / SaaS / multi-tenant / SSO / OpenTelemetry export / TUI / mobile native — all OUT of scope (CHARTER.md §3 and §13). Do not pre-scaffold "for later".
5. **PR size ceiling: 400 LOC changed in `src/`.** Split larger work. Docs-only PRs can be larger.
6. **Total LOC ceiling for v1.0: 8000 in `src/`.** When you approach this, the next PR must be a refactoring PR before any new feature PR.
7. **Runtime dependency ceiling: 20.** Adding one requires justification in the PR description.
8. **Env var ceiling: 12.** Each new one requires a `// why:` one-liner above its declaration in `src/config.ts`.

## When you must STOP and ask

Open an issue with label `needs-human` and stop work if:
- Your change does NOT trace to a CHARTER.md section.
- Your change is on the OUT list (§3) or refused list (§13).
- Your change would push LOC / deps / env-vars over their ceilings.
- You believe an abstraction is justified with only 1 current implementation.
- You believe a CHARTER decision is wrong and want to revise it (propose an ADR — do not just bypass).

**Do not push a PR in any of these cases.** Open an issue with label `needs-human` and wait.

---

## Build / Test / Quality

Once `package.json` exists (after M0):

```bash
npm run gate          # tsc --noEmit && biome check && vitest run && npm run budget-check
npm run budget-check  # verifies LOC / deps / env-vars under ceilings
```

`npm run gate` is mandatory before every push. CI re-runs it on every PR.

## Branching (mandatory)

```
feature/<slug> → develop → release/<v> → main → tag
```

- Always branch from `develop`. Never push directly to `main`.
- Use git worktree so your edits stay isolated:
  ```bash
  mkdir -p .claude/worktrees
  git fetch origin
  git worktree add .claude/worktrees/<slug> -b feature/<slug> origin/develop
  ```
- After merge, clean up: `git worktree remove .claude/worktrees/<slug>`.

## Commits (Conventional Commits)

| Type | Bump | Use for |
|---|---|---|
| `fix:` `refactor:` `perf:` `chore:` `docs:` `test:` `ci:` | patch | Most work |
| `feat:` | minor | Genuine user-visible features (rare — when in doubt use `fix:`) |
| `feat!:` / `BREAKING CHANGE:` | major | NEVER without explicit maintainer approval |

## PR rules

Every PR MUST use `.github/PULL_REQUEST_TEMPLATE.md`. CI rejects PRs missing required fields (charter citation, anti-Aegis checklist, verification steps).

---

## Scoped rules (load on demand)

| Working on... | Load this rule |
|---|---|
| Anything | `CLAUDE.md` (this file — always) |
| Refusing or escalating | `.claude/rules/scope.md` |
| Avoiding Aegis traps | `.claude/rules/anti-aegis.md` |
| LOC / deps / env-var budgets | `.claude/rules/budgets.md` |
| End-to-end workflow | `.claude/rules/workflow.md` |
| PR requirements | `.claude/rules/prs.md` |
| Testing | `.claude/rules/testing.md` |

## Architecture (read once, reference often)

See `CHARTER.md §5`. Four layers, no more:

1. **Ingest** — `src/ingest/` — fs.watch + JSONL parser + OAuth poller.
2. **Metrics** — `src/metrics/` — aggregation + cost + efficiency.
3. **Surface** — `src/server.ts` (routes) + `src/ui/` (Astro) + `src/rules/` + `src/channels/`.
4. **Storage** — `src/db.ts` — SQLite, single file, migrations inline.

Crossing these boundaries (e.g., UI directly reading filesystem) requires an ADR.

## How to give feedback on this file

If a rule blocks legitimate work: **propose an ADR** in `docs/adr/`. Do NOT skip the rule. Do NOT relax it in a one-off PR. The rule exists to prevent a specific past failure — relaxing it requires evidence and ceremony.
