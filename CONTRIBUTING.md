# Contributing to Polaris

Polaris is currently in a pre-alpha bootstrap phase. We are not yet accepting external contributions for code changes. Once we reach Beta (M2 — see [CHARTER.md §9](./CHARTER.md)), contributing guidelines below take effect.

---

## Before you contribute

1. **Read [CHARTER.md](./CHARTER.md)** — especially §3 (IN/OUT scope) and §13 (refused features). If your idea is on the OUT or refused list, this is not the right project for that idea.
2. **Read [docs/DEV_PROCESS.md](./docs/DEV_PROCESS.md)** — the full workflow.
3. **Read [CLAUDE.md](./CLAUDE.md)** — applies to humans too. The 8 hard rules are universal.

## Workflow summary

1. **Issue first.** Every non-trivial change has a GitHub issue.
2. **Charter citation.** The issue body cites the CHARTER.md section that authorizes the change.
3. **Maintainer green-light.** Issues need label `ready-for-work` from a maintainer before you start.
4. **Worktree branch.** `feature/<slug>` from `origin/develop`.
5. **Local gate.** `npm run gate` must pass before pushing.
6. **PR to `develop`.** Fill the PR template (it is mandatory — CI rejects PRs without required fields).
7. **Review + merge.** Maintainer reviews. Self-merge only in explicit solo-mode.

## Code of conduct

Be respectful. Disagreement is fine, dismissiveness is not. Open issues for proposals, not subreddits — argue on the merits.

## Security

Do not open public issues for security vulnerabilities. Email the maintainer instead (see profile).

## License

By contributing, you agree your contributions are licensed under MIT (see [LICENSE](./LICENSE)).
