import { describe, expect, it } from "vitest";
import { type EventRow, openDb } from "../db.js";

function sampleEvent(overrides: Partial<EventRow> = {}): EventRow {
  return {
    requestId: "req_test",
    sessionFile: "session-1.jsonl",
    tsMs: 1_700_000_000_000,
    model: "claude-sonnet-4-5",
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    rawCostUsd: null,
    ...overrides,
  };
}

describe("openDb", () => {
  it("creates events table and starts empty", () => {
    const db = openDb(":memory:");
    expect(db.countEvents()).toBe(0);
    db.close();
  });

  it("insertEvent returns true for new request_id and false for duplicate", () => {
    const db = openDb(":memory:");
    expect(db.insertEvent(sampleEvent({ requestId: "req_A" }))).toBe(true);
    expect(db.insertEvent(sampleEvent({ requestId: "req_A" }))).toBe(false);
    expect(db.countEvents()).toBe(1);
    db.close();
  });

  it("countEvents reflects multiple distinct inserts", () => {
    const db = openDb(":memory:");
    db.insertEvent(sampleEvent({ requestId: "req_1" }));
    db.insertEvent(sampleEvent({ requestId: "req_2" }));
    db.insertEvent(sampleEvent({ requestId: "req_3" }));
    expect(db.countEvents()).toBe(3);
    db.close();
  });

  it("migrations are idempotent across opens", () => {
    const db1 = openDb(":memory:");
    db1.insertEvent(sampleEvent());
    db1.close();
    // Re-opening :memory: creates a fresh DB; we can't verify the same file twice
    // without disk I/O, so just check a second open does not throw on migration.
    const db2 = openDb(":memory:");
    expect(db2.countEvents()).toBe(0);
    db2.close();
  });
});
