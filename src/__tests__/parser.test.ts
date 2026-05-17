import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseJsonl } from "../ingest/jsonl-parser.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string =>
  readFileSync(resolve(here, "fixtures", "jsonl", name), "utf8");

describe("parseJsonl", () => {
  it("extracts events from single-session.jsonl", () => {
    const result = parseJsonl(fixture("single-session.jsonl"), "single-session");
    expect(result.skipped).toBe(0);
    expect(result.events).toHaveLength(3);
    expect(result.events[0]).toMatchObject({
      requestId: "req_001",
      model: "claude-sonnet-4-5",
      inputTokens: 1000,
      outputTokens: 500,
      rawCostUsd: 0.0105,
    });
  });

  it("extracts duplicate requestId from compact-retry.jsonl (dedup happens later)", () => {
    const result = parseJsonl(fixture("compact-retry.jsonl"), "compact-retry");
    expect(result.events).toHaveLength(3);
    const ids = result.events.map((e) => e.requestId);
    expect(ids).toEqual(["req_010", "req_011", "req_010"]);
  });

  it("preserves model names verbatim", () => {
    const result = parseJsonl(fixture("mixed-models.jsonl"), "mixed-models");
    expect(result.events.map((e) => e.model)).toEqual([
      "claude-opus-4-6-20260101",
      "claude-sonnet-4-5",
      "claude-haiku-4-5",
    ]);
  });

  it("skips malformed lines and non-assistant lines, returns valid events", () => {
    const result = parseJsonl(fixture("corrupted.jsonl"), "corrupted");
    expect(result.events).toHaveLength(2);
    expect(result.skipped).toBe(2);
    expect(result.events.map((e) => e.requestId)).toEqual(["req_300", "req_301"]);
  });

  it("returns empty for empty input", () => {
    const result = parseJsonl("", "empty");
    expect(result.events).toHaveLength(0);
    expect(result.skipped).toBe(0);
  });

  it("returns empty for whitespace-only input", () => {
    const result = parseJsonl("\n  \n\n  ", "whitespace");
    expect(result.events).toHaveLength(0);
    expect(result.skipped).toBe(0);
  });

  it("attaches the supplied sessionFile to every event", () => {
    const result = parseJsonl(fixture("single-session.jsonl"), "my-session-file");
    for (const event of result.events) {
      expect(event.sessionFile).toBe("my-session-file");
    }
  });
});
