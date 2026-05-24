import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractToolLineCounts, parseJsonl } from "../ingest/jsonl-parser.js";

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

  it("v0.23.0: events default linesAdded/linesRemoved to 0 when no tool_use blocks", () => {
    const result = parseJsonl(fixture("single-session.jsonl"), "no-tools");
    for (const event of result.events) {
      expect(event.linesAdded).toBe(0);
      expect(event.linesRemoved).toBe(0);
    }
  });
});

describe("extractToolLineCounts", () => {
  it("returns 0/0 for non-array content", () => {
    expect(extractToolLineCounts(null)).toEqual({ added: 0, removed: 0 });
    expect(extractToolLineCounts(undefined)).toEqual({ added: 0, removed: 0 });
    expect(extractToolLineCounts("not array")).toEqual({ added: 0, removed: 0 });
  });

  it("counts Edit old_string -> removed, new_string -> added", () => {
    const c = extractToolLineCounts([
      {
        type: "tool_use",
        name: "Edit",
        input: { old_string: "a\nb\nc", new_string: "x\ny" },
      },
    ]);
    expect(c).toEqual({ added: 2, removed: 3 });
  });

  it("counts Write content -> added (no removal)", () => {
    const c = extractToolLineCounts([
      { type: "tool_use", name: "Write", input: { content: "line1\nline2\nline3\n" } },
    ]);
    expect(c).toEqual({ added: 3, removed: 0 });
  });

  it("sums all MultiEdit operations", () => {
    const c = extractToolLineCounts([
      {
        type: "tool_use",
        name: "MultiEdit",
        input: {
          edits: [
            { old_string: "one\ntwo", new_string: "one-prime" },
            { old_string: "x", new_string: "x\ny\nz" },
          ],
        },
      },
    ]);
    expect(c).toEqual({ added: 4, removed: 3 });
  });

  it("treats NotebookEdit.new_source as added", () => {
    const c = extractToolLineCounts([
      { type: "tool_use", name: "NotebookEdit", input: { new_source: "cell\nrow" } },
    ]);
    expect(c).toEqual({ added: 2, removed: 0 });
  });

  it("ignores non-tool_use blocks and unknown tool names", () => {
    const c = extractToolLineCounts([
      { type: "text", text: "ignore me" },
      { type: "tool_use", name: "Read", input: { file_path: "x" } },
      { type: "tool_use", name: "Bash", input: { command: "ls" } },
    ]);
    expect(c).toEqual({ added: 0, removed: 0 });
  });

  it("does not count a trailing newline as an extra line", () => {
    const c = extractToolLineCounts([
      { type: "tool_use", name: "Write", input: { content: "single line\n" } },
    ]);
    expect(c).toEqual({ added: 1, removed: 0 });
  });
});
