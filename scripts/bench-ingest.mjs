#!/usr/bin/env node
// Polaris perf bench — ingest throughput.
//
// Spins up an isolated Polaris instance against a fresh in-memory DB, pushes
// N synthetic JSONL events through /v1/ingest in a single batch, and reports
// the wall time.
//
// CHARTER §9 M2 exit criterion: "10k sessioni parsate in <5s in streaming".
// Default target: 10_000 events in under 5 seconds.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { buildServer } from "../dist/server.js";

const TOTAL = Number(process.env.BENCH_N ?? 10_000);
const TARGET_MS = Number(process.env.BENCH_TARGET_MS ?? 5_000);
const TOKEN = "bench-token-1234567890";

function buildJsonl(count) {
  const now = Date.now();
  const lines = [];
  for (let i = 0; i < count; i++) {
    const ts = new Date(now - (count - i) * 1000).toISOString();
    lines.push(
      JSON.stringify({
        timestamp: ts,
        type: "assistant",
        requestId: `bench-${i}`,
        uuid: `u-bench-${i}`,
        message: {
          model: i % 3 === 0 ? "claude-opus-4-7" : "claude-sonnet-4-6",
          usage: {
            input_tokens: 1000 + (i % 500),
            output_tokens: 100 + (i % 200),
            cache_read_input_tokens: i % 10 === 0 ? 50_000 : 0,
            cache_creation_input_tokens: 0,
          },
        },
      }),
    );
  }
  return lines.join("\n");
}

async function main() {
  const tmp = mkdtempSync(resolve(tmpdir(), "polaris-bench-"));
  const dbPath = resolve(tmp, "polaris-bench.db");
  process.env.POLARIS_AUTH_TOKEN = TOKEN;
  process.env.POLARIS_DB_PATH = dbPath;
  process.env.POLARIS_WATCH_DIR = "";

  const { app } = await buildServer();
  await app.ready();

  try {
    const content = buildJsonl(TOTAL);
    const t0 = process.hrtime.bigint();
    const res = await app.inject({
      method: "POST",
      url: "/v1/ingest",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
      },
      payload: JSON.stringify({ sessionFile: "/tmp/bench.jsonl", content }),
    });
    const t1 = process.hrtime.bigint();
    const elapsedMs = Number(t1 - t0) / 1_000_000;

    if (res.statusCode !== 200) {
      console.error(`✗ ingest returned HTTP ${res.statusCode}: ${res.body}`);
      process.exitCode = 2;
      return;
    }
    const body = JSON.parse(res.body);
    const ok = elapsedMs <= TARGET_MS;
    const rate = Math.round(body.inserted / (elapsedMs / 1000));
    console.log(
      `${ok ? "✓" : "✗"} ingest: ${body.inserted} events in ${elapsedMs.toFixed(0)}ms ` +
        `(${rate.toLocaleString()} events/s, target <=${TARGET_MS}ms)`,
    );
    if (body.parsed !== TOTAL) {
      console.error(`  parsed=${body.parsed} expected=${TOTAL}`);
      process.exitCode = 2;
    }
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
