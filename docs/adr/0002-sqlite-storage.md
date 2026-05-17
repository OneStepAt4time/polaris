# ADR-0002: SQLite as primary (and only) storage in v1.0

- **Status**: Accepted
- **Date**: 2026-05-17
- **Charter ref**: §3 IN scope, §6 Tech Stack

## Context

Polaris persists:
- Parsed JSONL events (per-request token usage, sessions)
- Daily and minute-level aggregates (cost, efficiency, lines changed)
- Rate-limit history (OAuth `/api/oauth/usage` poll results)
- Notification dispatch log (idempotency, "did we already alert on this?")
- User-controlled configuration (project renames, hides, merges, stars)

Workload characteristics:
- Single writer (one Polaris process per machine).
- Read-heavy: dashboard queries, time-range filters, project drill-downs.
- Total data size: kilobytes per day for an active developer, ~10 MB/year.
- No concurrent multi-machine writers (ADR-0004 single-user).
- No replication, HA, or failover requirement.

Aegis's "pluggable session store" had memory, Postgres, and (half-implemented) Redis backends. The Postgres path was never instantiated; the abstraction was load-bearing overhead with zero realized benefit.

## Decision

**SQLite is the only storage in Polaris v1.0.** Single file at a configurable path (default `${XDG_DATA_HOME:-~/.local/share}/polaris/polaris.db` on Unix, `%APPDATA%\polaris\polaris.db` on Windows). Accessed via `better-sqlite3` (synchronous, embedded, zero ops).

**No storage abstraction.** Domain code touches `src/db.ts` directly via typed helpers. There is no `interface MetricsStore`, no `*Repository`, no `*DataSource`.

**Migrations inline** in `src/db.ts` as a single `runMigrations(db)` function executed on startup. Each migration is a numbered SQL statement; `_polaris_migrations` table records applied versions.

## Consequences

**Gains**
- Zero operational concept: backup = copy file, restore = paste file.
- ~10 ms latency for any query — well under perception threshold.
- Synchronous API means no connection pool, no lock manager, no async transaction dance.
- Single-file = trivial Docker volume mount.
- Type-safe row results via Zod parsing at the `src/db.ts` boundary.

**Trade-offs**
- Single-process writer: future multi-machine deployments would need a different layer.
- No replication: backups are the user's responsibility.
- `better-sqlite3` is native; cross-platform CI must rebuild per platform (handled by GitHub Actions matrix).

**Risks accepted**
- A future v3 may need multi-machine aggregation. The refactoring is bounded (storage layer only; domain stays). We pay that cost when it's real, not before.

## Reversibility

Cost to revoke (move to Postgres or another DB): **moderate** — touch every storage call site, but call sites are concentrated in `src/db.ts`. Procedural cost: write ADR-NNNN superseding this one.

Cost to keep: **zero**.

Sticky-by-volume (data on disk in SQLite format) but not architecturally locked. A migration script could export to any other store.
