# Performance

Polaris is a single-user, single-process server with a SQLite store. Two
benchmark scripts validate the M2 exit criteria from CHARTER §9:

| Workload | M2 target | Bench script |
|---|---|---|
| Ingest 10k events | < 5 s | `scripts/bench-ingest.mjs` |
| /v1/metrics p99 | < 100 ms | `scripts/bench-metrics.mjs` |

## Running

```bash
# Both
npm run bench

# Individually (faster iteration)
npm run bench:ingest
npm run bench:metrics
```

Each script spins up an isolated Polaris instance against a temp DB,
loads synthetic data, runs the workload, and exits non-zero if the
target is missed. Both rebuild the TypeScript artifact (`npm run build`)
on each invocation so what's measured is what would ship.

## Tuning knobs

Environment variables:

| Var | Default | Effect |
|---|---|---|
| `BENCH_N` | `10000` | Number of events `bench-ingest` pushes through `/v1/ingest`. |
| `BENCH_TARGET_MS` | `5000` | Maximum acceptable wall time for ingest. |
| `BENCH_SEED` | `10000` | Events pre-loaded before `bench-metrics` starts timing. |
| `BENCH_QUERIES` | `500` | Total `/v1/metrics?range=today` queries to issue. 500 samples puts p99 on the 5th-from-last sample — much more stable than 100. |
| `BENCH_CONCURRENCY` | `1` | Concurrent in-flight queries. 1 = M2 single-user single-tab case. better-sqlite3 is synchronous, so higher values measure connection-serialization more than the aggregator itself. |
| `BENCH_P99_MS` | `100` | Maximum acceptable p99 latency. |

## What is and isn't measured

**Measured**:
- JSONL parse + dedup + SQLite insert (ingest bench).
- Time-range aggregation + per-model bucketing + cost calculation
  (metrics bench).
- Fastify request/response overhead (both benches use `app.inject`,
  same code path as a real HTTP call but skipping the TCP layer).

**Not measured**:
- TCP/TLS overhead (~1–2 ms on localhost, more over network).
- Static UI serving (`@fastify/static` reads from disk — negligible
  with OS page cache).
- SSE streaming for sessions (separate latency profile).
- Anthropic OAuth poll (network-bound to api.anthropic.com).
- Rules engine tick (runs once every 5 min, not in the hot path).

## Expected results on a developer laptop

These are not contracts — shape-of-the-curve numbers from the
maintainer's machine (Windows 11, NVMe, Node 22):

```
✓ ingest:  10000 events in ~1100 ms (~9k events/s, target <=5000 ms)
✓ metrics: 500 queries · p50=~20 ms p95=~28 ms p99=~35 ms
  (target p99<=100 ms, seed=10000 events, concurrency=1)
```

Both well under target. With `BENCH_CONCURRENCY=4` (4 dashboard tabs)
p99 climbs to ~135 ms — that's the SQLite-sync queue wait, not the
aggregator itself.

If your dashboard p99 is far above the bench, suspect:

- SQLite running on a network filesystem instead of local NVMe.
- `journal_mode != WAL` (Polaris sets WAL on open — verify with
  `PRAGMA journal_mode;`).
- Anti-virus scanning the DB file on every write.
- A debugger attached.

## CI

The bench scripts are NOT in the CI gate. CI runs `npm run gate`
(typecheck + lint + unit tests + budget). The bench is a manual
regression check before tagging releases that touch the hot path:
`src/ingest/jsonl-parser.ts`, `src/metrics/aggregator.ts`,
`src/db.ts`, or any new schema migration.
