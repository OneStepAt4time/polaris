import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type PolarisDb, openDb } from "../db.js";
import { ingest } from "../ingest/ingest.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string =>
  readFileSync(resolve(here, "fixtures", "jsonl", name), "utf8");

describe("ingest", () => {
  let db: PolarisDb;

  beforeEach(() => {
    db = openDb(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("ingests single-session.jsonl: 3 events, no duplicates", () => {
    const result = ingest(db, "single-session", fixture("single-session.jsonl"));
    expect(result.parsed).toBe(3);
    expect(result.skipped).toBe(0);
    expect(result.duplicatesInBatch).toBe(0);
    expect(result.inserted).toBe(3);
    expect(result.duplicatesInDb).toBe(0);
    expect(db.countEvents()).toBe(3);
  });

  it("dedupes /compact retries in-batch", () => {
    const result = ingest(db, "compact-retry", fixture("compact-retry.jsonl"));
    expect(result.parsed).toBe(3);
    expect(result.duplicatesInBatch).toBe(1); // req_010 appears twice in fixture
    expect(result.inserted).toBe(2);
    expect(db.countEvents()).toBe(2);
  });

  it("dedupes sub-agent mirror across two ingest calls", () => {
    const a = ingest(db, "sub-agent-A", fixture("sub-agent-A.jsonl"));
    expect(a.inserted).toBe(2); // req_100, req_101
    const b = ingest(db, "sub-agent-B", fixture("sub-agent-B.jsonl"));
    expect(b.parsed).toBe(1); // req_100 mirror
    expect(b.inserted).toBe(0); // already in DB
    expect(b.duplicatesInDb).toBe(1);
    expect(db.countEvents()).toBe(2);
  });

  it("preserves events across mixed models in single ingest", () => {
    const result = ingest(db, "mixed-models", fixture("mixed-models.jsonl"));
    expect(result.parsed).toBe(3);
    expect(result.inserted).toBe(3);
    expect(db.countEvents()).toBe(3);
  });

  it("ingests corrupted.jsonl: skips malformed and non-assistant lines", () => {
    const result = ingest(db, "corrupted", fixture("corrupted.jsonl"));
    expect(result.parsed).toBe(2);
    expect(result.skipped).toBe(2); // malformed JSON + user-type line without usage
    expect(result.inserted).toBe(2);
    expect(db.countEvents()).toBe(2);
  });

  it("idempotent: ingesting the same content twice inserts zero the second time", () => {
    const first = ingest(db, "single", fixture("single-session.jsonl"));
    expect(first.inserted).toBe(3);
    const second = ingest(db, "single", fixture("single-session.jsonl"));
    expect(second.inserted).toBe(0);
    expect(second.duplicatesInDb).toBe(3);
    expect(db.countEvents()).toBe(3);
  });
});
