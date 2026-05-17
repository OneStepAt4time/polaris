import { describe, expect, it } from "vitest";
import { dedupByRequestId } from "../ingest/dedup.js";
import type { NormalizedEvent } from "../ingest/jsonl-parser.js";

function event(overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    requestId: "req",
    sessionFile: "a.jsonl",
    tsMs: 1_000,
    model: "claude-sonnet-4-5",
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    rawCostUsd: null,
    lineUuid: null,
    ...overrides,
  };
}

describe("dedupByRequestId", () => {
  it("returns empty for empty input", () => {
    const result = dedupByRequestId([]);
    expect(result.kept).toHaveLength(0);
    expect(result.duplicates).toBe(0);
  });

  it("keeps unique events untouched", () => {
    const events = [
      event({ requestId: "req_1" }),
      event({ requestId: "req_2" }),
      event({ requestId: "req_3" }),
    ];
    const result = dedupByRequestId(events);
    expect(result.kept).toHaveLength(3);
    expect(result.duplicates).toBe(0);
  });

  it("dedupes events with the same requestId, picking earliest timestamp", () => {
    const events = [
      event({ requestId: "req_A", tsMs: 2_000, sessionFile: "later.jsonl" }),
      event({ requestId: "req_A", tsMs: 1_000, sessionFile: "earlier.jsonl" }),
      event({ requestId: "req_A", tsMs: 3_000, sessionFile: "latest.jsonl" }),
    ];
    const result = dedupByRequestId(events);
    expect(result.kept).toHaveLength(1);
    expect(result.duplicates).toBe(2);
    expect(result.kept[0]).toMatchObject({ tsMs: 1_000, sessionFile: "earlier.jsonl" });
  });

  it("breaks timestamp ties by sessionFile lexicographic order (deterministic)", () => {
    const events = [
      event({ requestId: "req_X", tsMs: 5_000, sessionFile: "z-file.jsonl" }),
      event({ requestId: "req_X", tsMs: 5_000, sessionFile: "a-file.jsonl" }),
    ];
    const result = dedupByRequestId(events);
    expect(result.kept).toHaveLength(1);
    expect(result.kept[0]?.sessionFile).toBe("a-file.jsonl");
  });

  it("preserves distinct requestIds across multiple sessions", () => {
    const events = [
      event({ requestId: "req_1", sessionFile: "s1" }),
      event({ requestId: "req_2", sessionFile: "s1" }),
      event({ requestId: "req_1", sessionFile: "s2" }), // mirror
      event({ requestId: "req_3", sessionFile: "s2" }),
    ];
    const result = dedupByRequestId(events);
    expect(result.kept.map((e) => e.requestId).sort()).toEqual(["req_1", "req_2", "req_3"]);
    expect(result.duplicates).toBe(1);
  });
});
