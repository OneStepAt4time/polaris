import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type PolarisDb, openDb } from "../db.js";
import { type WatcherHandle, _expandHome, startWatcher } from "../ingest/jsonl-watcher.js";

const sampleEvent = (req: string, ts: string): string =>
  `${JSON.stringify({
    timestamp: ts,
    type: "assistant",
    message: {
      model: "claude-sonnet-4-5",
      usage: { input_tokens: 1000, output_tokens: 500 },
    },
    requestId: req,
    uuid: `u-${req}`,
  })}\n`;

describe("startWatcher", () => {
  let tmpDir: string;
  let db: PolarisDb;
  let watcher: WatcherHandle;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "polaris-watcher-"));
    db = openDb(":memory:");
    watcher = startWatcher(tmpDir, db, { debounceMs: 50 });
  });

  afterEach(async () => {
    watcher.close();
    db.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("ingests events from a newly created JSONL file", async () => {
    const projectDir = join(tmpDir, "proj1");
    await mkdir(projectDir, { recursive: true });
    await writeFile(
      join(projectDir, "session-a.jsonl"),
      sampleEvent("req_w_001", "2026-05-18T10:00:00.000Z"),
    );

    await vi.waitFor(() => expect(db.countEvents()).toBe(1), { timeout: 5000, interval: 50 });
  });

  it("re-ingests when an existing file is appended", async () => {
    const projectDir = join(tmpDir, "proj2");
    await mkdir(projectDir, { recursive: true });
    const path = join(projectDir, "session-b.jsonl");
    await writeFile(path, sampleEvent("req_w_010", "2026-05-18T11:00:00.000Z"));

    await vi.waitFor(() => expect(db.countEvents()).toBe(1), { timeout: 5000, interval: 50 });

    await appendFile(path, sampleEvent("req_w_011", "2026-05-18T11:01:00.000Z"));

    await vi.waitFor(() => expect(db.countEvents()).toBe(2), { timeout: 5000, interval: 50 });
  });

  it("ignores non-.jsonl files", async () => {
    await writeFile(join(tmpDir, "notes.txt"), "not a jsonl");
    await writeFile(join(tmpDir, "log.json"), "{}");

    // Give the watcher more than its debounce window. countEvents should remain 0.
    await new Promise((r) => setTimeout(r, 250));
    expect(db.countEvents()).toBe(0);
  });

  it("returns a no-op handle when the path does not exist", () => {
    const noop = startWatcher(join(tmpdir(), `polaris-nonexistent-${Date.now()}`), db);
    // No throw, close is callable.
    expect(() => noop.close()).not.toThrow();
  });

  it("close() stops further ingestion", async () => {
    const projectDir = join(tmpDir, "proj3");
    await mkdir(projectDir, { recursive: true });
    await writeFile(
      join(projectDir, "session-c.jsonl"),
      sampleEvent("req_w_020", "2026-05-18T12:00:00.000Z"),
    );
    await vi.waitFor(() => expect(db.countEvents()).toBe(1), { timeout: 5000, interval: 50 });

    watcher.close();

    // After close, new writes should not trigger ingestion.
    await writeFile(
      join(projectDir, "session-d.jsonl"),
      sampleEvent("req_w_021", "2026-05-18T12:01:00.000Z"),
    );
    await new Promise((r) => setTimeout(r, 250));
    expect(db.countEvents()).toBe(1);
  });
});

describe("_expandHome", () => {
  it('leaves paths that do not start with "~/" alone', () => {
    expect(_expandHome("/abs/path")).toBe("/abs/path");
    expect(_expandHome("./rel/path")).toBe("./rel/path");
    expect(_expandHome("")).toBe("");
  });

  it('expands "~" alone to homedir', () => {
    const result = _expandHome("~");
    expect(result.length).toBeGreaterThan(1);
    expect(result.includes("~")).toBe(false);
  });

  it('expands "~/foo" to <homedir>/foo', () => {
    const result = _expandHome("~/foo");
    expect(result.endsWith("foo")).toBe(true);
    expect(result.startsWith("~")).toBe(false);
  });
});
