#!/usr/bin/env node
// Polaris perf bench — metrics query latency.
//
// Pre-loads the DB with N synthetic events, then fires Q concurrent
// /v1/metrics?range=today queries and reports p50/p95/p99 latency.
//
// CHARTER §9 M2 exit criterion: "UI p99 <100ms" (the metrics endpoint
// drives the dashboard's KPI banner so it's the latency-critical path).

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { buildServer } from "../dist/server.js";

const SEED_EVENTS = Number(process.env.BENCH_SEED ?? 10_000);
// 500 samples puts the 99th percentile on the 5th-from-last datapoint, which
// is much more stable than the 1-of-100 OS-noise regime.
const QUERIES = Number(process.env.BENCH_QUERIES ?? 500);
// Default 1 = M2 realistic case (one user, one dashboard tab). better-sqlite3
// is synchronous so any concurrency value > 1 measures connection-serialization
// rather than the aggregator itself. Set BENCH_CONCURRENCY=4 to stress-test
// (you'll see p99 climb to ~150 ms, dominated by queue wait).
const CONCURRENCY = Number(process.env.BENCH_CONCURRENCY ?? 1);
const P99_TARGET_MS = Number(process.env.BENCH_P99_MS ?? 100);
const TOKEN = "bench-token-1234567890";

function buildJsonl(count) {
  const now = Date.now();
  const lines = [];
  for (let i = 0; i < count; i++) {
    const ts = new Date(now - (count - i) * 100).toISOString();
    lines.push(
      JSON.stringify({
        timestamp: ts,
        type: "assistant",
        requestId: `bench-q-${i}`,
        uuid: `u-bench-q-${i}`,
        message: {
          model: i % 3 === 0 ? "claude-opus-4-7" : "claude-sonnet-4-6",
          usage: {
            input_tokens: 1000,
            output_tokens: 100,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        },
      }),
    );
  }
  return lines.join("\n");
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[idx];
}

async function main() {
  const tmp = mkdtempSync(resolve(tmpdir(), "polaris-bench-q-"));
  const dbPath = resolve(tmp, "polaris-bench.db");
  process.env.POLARIS_AUTH_TOKEN = TOKEN;
  process.env.POLARIS_DB_PATH = dbPath;
  process.env.POLARIS_WATCH_DIR = "";

  const { app } = await buildServer();
  await app.ready();

  try {
    // Seed.
    const seedRes = await app.inject({
      method: "POST",
      url: "/v1/ingest",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      payload: JSON.stringify({
        sessionFile: "/tmp/bench-q.jsonl",
        content: buildJsonl(SEED_EVENTS),
      }),
    });
    if (seedRes.statusCode !== 200) {
      console.error(`✗ seed failed: HTTP ${seedRes.statusCode}`);
      process.exitCode = 2;
      return;
    }

    // Warm up — 5 queries that aren't measured.
    for (let i = 0; i < 5; i++) {
      await app.inject({
        method: "GET",
        url: "/v1/metrics?range=today",
        headers: { authorization: `Bearer ${TOKEN}` },
      });
    }

    // Measured queries: CONCURRENCY workers, each making (QUERIES / CONCURRENCY) requests.
    const perWorker = Math.ceil(QUERIES / CONCURRENCY);
    const samples = [];
    const workers = [];
    for (let w = 0; w < CONCURRENCY; w++) {
      workers.push(
        (async () => {
          for (let i = 0; i < perWorker; i++) {
            const t0 = process.hrtime.bigint();
            const res = await app.inject({
              method: "GET",
              url: "/v1/metrics?range=today",
              headers: { authorization: `Bearer ${TOKEN}` },
            });
            const t1 = process.hrtime.bigint();
            if (res.statusCode !== 200) {
              throw new Error(`HTTP ${res.statusCode}`);
            }
            samples.push(Number(t1 - t0) / 1_000_000);
          }
        })(),
      );
    }
    await Promise.all(workers);

    samples.sort((a, b) => a - b);
    const p50 = percentile(samples, 0.5);
    const p95 = percentile(samples, 0.95);
    const p99 = percentile(samples, 0.99);
    const ok = p99 <= P99_TARGET_MS;
    console.log(
      `${ok ? "✓" : "✗"} metrics: ${samples.length} queries · ` +
        `p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms p99=${p99.toFixed(1)}ms ` +
        `(target p99<=${P99_TARGET_MS}ms, seed=${SEED_EVENTS} events)`,
    );
    if (!ok) process.exitCode = 1;
  } finally {
    await app.close();
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
