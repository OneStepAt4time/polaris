# Budgets — hard ceilings for v1.0

> Aegis had no ceilings. It grew from "Fastify bridge" to 189 backend files + 366 dashboard files. Ceilings are how we stop that here.

## The four budgets

| Budget | Ceiling v1.0 | Soft alert at | Action when exceeded |
|---|---|---|---|
| Total LOC in `src/` | **8000** | 7500 | Refactor PR before any feature PR |
| Source LOC delta per PR | **400** | 300 | Split the PR |
| Runtime dependencies | **20** | 18 | Dep-audit PR before adding |
| Env vars in `src/config.ts` | **12** | 10 | Consolidate or remove first |

Plus implicit budgets:
- Test files: no ceiling, but tests should not outnumber `src/` files. Aegis had 302 tests, mostly unit-mocked, while the actual flow had zero integration coverage.
- Docs: no ceiling, but each new doc must replace an older one OR cover a genuinely new topic.

## How budgets are enforced

### Locally
```bash
npm run budget-check
```
Prints current vs ceiling for each budget. Fails (non-zero exit) if any ceiling is exceeded. Runs as part of `npm run gate`.

### In CI
`.github/workflows/loc-budget.yml`, `deps-budget.yml`, `env-budget.yml`, `size-check.yml` re-run the checks on every PR. Failed budget = blocked merge.

## How to count

| Budget | Counting method |
|---|---|
| Total LOC | `cloc src/ --exclude-dir=__tests__` |
| PR delta | `git diff --shortstat <base>..<head> -- 'src/**' | awk '{print $4 + $6}'` |
| Runtime deps | `jq '.dependencies | length' package.json` |
| Env vars | `grep -c "^\s*export const \w\+ =" src/config.ts` or static AST count |

## What does NOT count toward LOC budget

- `src/__tests__/**` (test files)
- `*.astro` UI templates (UI complexity is bounded by feature scope, not LOC)
- Generated files
- Vendored type definitions

## What does NOT count toward deps budget

- `devDependencies`
- `peerDependencies` that are optional
- Bundled (vendored) code

## Soft alerts

When a budget hits the soft alert threshold:
- Add a `budget-attention` label to the next PR that touches the affected area.
- Open a tracking issue: "Address rising X count: at N, ceiling N+M".
- The audit phase (DEV_PROCESS Phase 7) catches drift between alerts.

## When you genuinely need to raise a ceiling

1. Open an ADR proposal: `docs/adr/NNNN-raise-X-ceiling.md`.
2. Justification must include: what concrete v1 feature requires the higher ceiling, what was tried first, why it didn't fit.
3. Maintainer approval required before the ceiling moves.

**No silent ceiling raises.** "I'll just bump it from 20 to 25" is exactly how Aegis grew unbounded.
