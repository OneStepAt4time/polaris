# Workflow — end-to-end path

> Every contributor (human or AI agent) follows this path. The longer version is at `docs/DEV_PROCESS.md`; this file is the shortlist.

## The path

```
CHARTER.md  →  Issue (with charter citation)
                       ↓
           Maintainer adds `ready-for-work` label
                       ↓
        feature/<slug> worktree from origin/develop
                       ↓
           Code with scoped rules loaded
                       ↓
              `npm run gate` (local, mandatory)
                       ↓
             Manual end-to-end verification
                       ↓
           PR to develop using template
                       ↓
          CI gates: charter / size / loc / deps / env / tests
                       ↓
                 Maintainer review
                       ↓
                Squash merge to develop
                       ↓
       Worktree removed; develop → release/* → main → tag
```

## Branch model

```
feature/* / fix/* / refactor/* / chore/*  ──PR──>  develop  ──PR──>  main  ──>  Release Please  ──>  npm + GHCR
```

- `develop` = integration branch (current work converges here).
- `main` = production (only release PRs land here).
- `release/<version>` = stabilization (Release Please opens these PRs automatically).

## Branch naming

```
feature/<slug>     # new user-visible behavior (rare)
fix/<slug>         # bug fix
refactor/<slug>    # restructuring without behavior change
perf/<slug>        # speed/memory
chore/<slug>       # build, deps, CI, dotfiles
docs/<slug>        # docs only
test/<slug>        # tests only
ci/<slug>          # CI/workflow only
hotfix/<slug>      # emergency fix off main (rare)
```

Slug: lowercase, hyphens, 2-5 words. Example: `feature/heatmap-quartile-coloring`.

## Worktree (mandatory)

```bash
mkdir -p .claude/worktrees
git fetch origin
git worktree add .claude/worktrees/<slug> -b <type>/<slug> origin/develop
cd .claude/worktrees/<slug>
```

After merge:
```bash
git worktree remove .claude/worktrees/<slug>
```

## Rules of thumb

- **When in doubt about scope**: do NOT start the PR. Open issue with `needs-human` label.
- **When in doubt about feat vs fix**: choose `fix`. `feat` is rare and triggers minor version bump.
- **When in doubt about test depth**: write the integration test. Mock-heavy unit tests were Aegis's false security.
- **When in doubt about ADRs**: write one. Cheap to write, expensive to skip later.

## What NOT to do

- ❌ Never push directly to `main`.
- ❌ Never open a PR with failing CI.
- ❌ Never `--no-verify` or bypass hooks. If a hook fails, fix the underlying issue.
- ❌ Never bundle unrelated changes in one PR.
- ❌ Never start work on an issue without `ready-for-work` label.
- ❌ Never resolve a `needs-human` block by yourself.
