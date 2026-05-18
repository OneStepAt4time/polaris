# PR rules

## Before opening a PR

Quality gate must pass locally:

```bash
npm run gate
```

`npm run gate` runs (in order, fail-fast):

1. `tsc --noEmit` — type check.
2. `biome check` — lint + format.
3. `vitest run` — full test suite.
4. `npm run budget-check` — LOC / deps / env-var ceilings.

If any step fails: fix it. **Do not push.** Do not `--no-verify`.

## PR template — mandatory fields

CI rejects PRs that don't fill these fields:

1. **Summary** — 1-2 sentences on what and why.
2. **Charter alignment** — `CHARTER.md section: §N` citation. (CI greps for this regex.)
3. **Anti-Aegis checklist** — all 4 boxes must be ticked or explicitly waived with a comment.
4. **Budgets** — LOC delta, new deps count, new env-vars count.
5. **Tests** — what tests were added, what was manually verified.
6. **Verification** — concrete reproducible steps (`curl`, browser action, shell command).
7. **Issue link** — `Closes #N`.

## PR size

- **400 LOC ceiling** in `src/` per PR. CI enforces.
- Docs-only PRs can be larger but should still be focused (one topic).
- Multi-concern PRs are split before review begins.

## Title

Conventional Commits format:

```
<type>: <imperative-mood description ≤70 chars>
```

Examples:
- `fix: dedup JSONL events when /compact retries appear`
- `feat: rate-limit-near rule (cost-threshold pattern)`
- `refactor: extract pricing table loader to its own module`

`feat:` PRs require maintainer review + approval. CI will flag them.

## Review

- Maintainer (Emanuele in solo-mode) reviews every PR.
- "Approve" requires:
  - Charter citation accurate.
  - Anti-Aegis checklist green or explicitly defended.
  - Verification reproducible.
  - Tests cover the change.
- "Request changes" = come back with code, not arguments.

## Merge

- **Squash merge** for multi-commit PRs.
- Branch auto-deleted post-merge.
- Worktree cleanup: `git worktree remove .claude/worktrees/<slug>`.

## Self-merge

Allowed only in solo-mode (single maintainer). Process:

1. CI fully green.
2. Self-review comment in PR: "Reviewed: charter §N confirmed, checklist X, verified by Y. Merging."
3. Squash merge.
4. Worktree cleanup.

When a second contributor joins: branch protection disables self-merge.

## Rejection criteria (PR will be closed without merge)

- Missing charter citation that you don't fix on request.
- Scope drift: PR introduces work outside the cited charter section.
- Premature abstraction: introduces interface/factory for 1 implementation.
- Half-wired code: file added but not reachable from entry point.
- Multi-concern: PR mixes unrelated changes after a "split" request.
- Stale: no activity for 30 days, no response to review comments.
