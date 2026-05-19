#!/usr/bin/env node
// One-shot: walk ~/.claude/projects/**/*.jsonl and POST each file to
// /v1/ingest. The watcher only re-parses on change; this catches the
// pre-existing history.
//
//   POLARIS_URL=http://127.0.0.1:9180   \
//   POLARIS_AUTH_TOKEN=<token>            \
//   POLARIS_CLAUDE_DIR=C:/Users/.../.claude/projects   \
//   node scripts/backfill.mjs

import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative } from "node:path";

const URL = process.env.POLARIS_URL || "http://127.0.0.1:9180";
const TOKEN = process.env.POLARIS_AUTH_TOKEN;
const ROOT = process.env.POLARIS_CLAUDE_DIR || join(homedir(), ".claude", "projects");

if (!TOKEN) {
  console.error("POLARIS_AUTH_TOKEN is required");
  process.exit(2);
}

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.isFile() && e.name.endsWith(".jsonl")) yield full;
  }
}

let files = 0;
let events = 0;
const start = Date.now();
for await (const abs of walk(ROOT)) {
  const rel = relative(ROOT, abs).replace(/\\/g, "/");
  const content = await readFile(abs, "utf8");
  const res = await fetch(`${URL}/v1/ingest`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({ sessionFile: rel, content }),
  });
  if (!res.ok) {
    console.error(`✗ ${rel} → ${res.status}`);
    continue;
  }
  const result = await res.json();
  files += 1;
  events += result.eventsIngested ?? 0;
  if (files % 25 === 0) console.log(`  ${files} files…`);
}
const elapsed = ((Date.now() - start) / 1000).toFixed(1);
console.log(`\n${files} files → ${events} events ingested in ${elapsed}s`);
