# Testing rules

> Aegis had 302 test files and shipped 8 broken tests on Windows. Tests are necessary, not sufficient.

## What MUST be tested

| Code area | Test type | Coverage target |
|---|---|---|
| `src/ingest/jsonl-parser.ts` | Unit + fixture | ≥80% |
| `src/metrics/*` | Unit | ≥80% |
| `src/rules/*` | Unit | ≥80% |
| `src/channels/*` | Unit (mock HTTP) | ≥60% |
| `src/server.ts` routes | Integration via HTTP | ≥60% |
| `src/db.ts` migrations | Integration | 100% (every migration tested) |
| `src/ui/` | Manual (Playwright optional in M2) | n/a |

## Required for every PR

1. **Unit tests** for changes in `src/metrics/`, `src/ingest/`, `src/rules/`. CI fails if coverage drops.
2. **Integration test** if the PR adds/changes an HTTP route or DB schema. Use the real Fastify + real SQLite in test mode. **No mocking the layer you're testing.**
3. **Manual verification** documented in PR body. Concrete steps. Concrete expected output.

## Test fixtures (JSONL)

We maintain anonymized real JSONL fixtures in `src/__tests__/fixtures/jsonl/`:

- `single-session.jsonl` — happy path.
- `compact-retry.jsonl` — `/compact` retry that creates duplicate events.
- `sub-agent.jsonl` — sub-agent transcripts that duplicate.
- `mixed-models.jsonl` — Opus + Sonnet + Haiku in same session.
- `corrupted.jsonl` — malformed lines mid-file.

Adding a new failure mode: add a fixture, write a test that proves the parser handles it.

## What NOT to mock

- **Do NOT mock SQLite.** Use in-memory or temp-file SQLite. Aegis lesson: mocked tests passed, real DB failed.
- **Do NOT mock the JSONL parser when testing metrics.** Use real fixtures.
- **Do NOT mock `fs` for the watcher test.** Use a real temp directory with real file appends.

## What to mock

- External HTTP (Telegram/Slack/Discord webhooks): mock with `undici` MockAgent or similar.
- Time/Date for deterministic tests: use Vitest's fake timers.
- Random for deterministic tests: seed `Math.random`.

## Acceptance test (every release)

Before tagging v0.X.Y:

1. Stop and restart server, verify clean boot.
2. Send a real JSONL append, verify event appears via HTTP within 5s.
3. Open UI on `localhost:3000`, verify dashboard renders.
4. Trigger a rule (low cost threshold), verify notification fires on a test Telegram channel.
5. Run `ccmeter` on the same dataset, compare totals — Polaris must match within ±1%.

If any acceptance step fails: do not tag the release. Iterate.

## Cross-platform

CI matrix: Linux + macOS + Windows. **Tests must pass on all three.** Aegis shipped Windows-broken tests because the matrix was incomplete. Polaris matrix is full from day 1.

## Flaky tests

A test that fails intermittently is a bug. Treat it like a production bug:
1. Open issue with label `flaky-test`.
2. Mark with `it.skip` only with a TODO and a deadline.
3. Fix within 2 weeks or delete the test (a deleted test is better than a misleading green).
