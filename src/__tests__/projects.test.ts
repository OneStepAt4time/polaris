import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type PolarisDb, openDb } from "../db.js";
import type { PricingTable } from "../metrics/pricing.js";
import {
  aggregateByProject,
  modelFamily,
  projectKey,
  resolveProjectsWindow,
} from "../metrics/projects.js";

const PRICING: PricingTable = {
  patterns: [{ match: "claude-test", input: 3, output: 15, cacheRead: 0.3 }],
  fallback: { input: 3, output: 15, cacheRead: 0.3 },
};

function insertEvent(
  db: PolarisDb,
  opts: {
    sessionFile: string;
    tsMs: number;
    outputTokens: number;
    reqSuffix?: string;
    model?: string;
    linesAdded?: number;
    linesRemoved?: number;
  },
): void {
  db.insertEvent({
    requestId: `req-${opts.tsMs}-${opts.outputTokens}-${opts.reqSuffix ?? ""}-${opts.sessionFile}`,
    sessionFile: opts.sessionFile,
    tsMs: opts.tsMs,
    model: opts.model ?? "claude-test",
    inputTokens: 0,
    outputTokens: opts.outputTokens,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    rawCostUsd: null,
    linesAdded: opts.linesAdded ?? 0,
    linesRemoved: opts.linesRemoved ?? 0,
  });
}

describe("projectKey", () => {
  it("returns the parent directory name for a session file (POSIX path)", () => {
    expect(projectKey("/home/u/.claude/projects/D--polaris/abc.jsonl")).toBe("D--polaris");
  });
  it("returns the parent directory name for a Windows path", () => {
    expect(projectKey("C:\\Users\\m\\.claude\\projects\\D--aegis\\sess.jsonl")).toBe("D--aegis");
  });
  it("returns (root) when the path has no parent directory", () => {
    expect(projectKey("session.jsonl")).toBe("(root)");
  });
});

describe("resolveProjectsWindow", () => {
  const now = new Date("2026-05-20T12:00:00Z").getTime();
  it("clamps days to >= 1", () => {
    expect(resolveProjectsWindow(0, now).days).toBe(1);
    expect(resolveProjectsWindow(-7, now).days).toBe(1);
  });
  it("clamps days to <= 365", () => {
    expect(resolveProjectsWindow(9999, now).days).toBe(365);
  });
  it("starts the window at UTC midnight of (today - (days-1))", () => {
    const w = resolveProjectsWindow(7, now);
    expect(new Date(w.fromMs).toISOString()).toBe("2026-05-14T00:00:00.000Z");
    expect(w.toMs).toBe(now);
  });
});

describe("aggregateByProject", () => {
  let db: PolarisDb;
  const now = new Date("2026-05-20T12:00:00Z").getTime();
  const day = 24 * 60 * 60 * 1000;
  const todayStartMs = new Date("2026-05-20T00:00:00Z").getTime();

  beforeEach(() => {
    db = openDb(":memory:");
  });
  afterEach(() => {
    db.close();
  });

  it("returns empty projects when DB is empty", () => {
    const result = aggregateByProject(db, PRICING, 30, now);
    expect(result.projects).toEqual([]);
    expect(result.days).toBe(30);
  });

  it("groups events by parent directory name", () => {
    insertEvent(db, {
      sessionFile: "/u/.claude/projects/proj-A/s1.jsonl",
      tsMs: todayStartMs + 1000,
      outputTokens: 100_000,
    });
    insertEvent(db, {
      sessionFile: "/u/.claude/projects/proj-A/s2.jsonl",
      tsMs: todayStartMs + 2000,
      outputTokens: 100_000,
    });
    insertEvent(db, {
      sessionFile: "/u/.claude/projects/proj-B/s3.jsonl",
      tsMs: todayStartMs + 3000,
      outputTokens: 50_000,
    });
    const result = aggregateByProject(db, PRICING, 30, now);
    expect(result.projects.map((p) => p.name).sort()).toEqual(["proj-A", "proj-B"]);
    const projA = result.projects.find((p) => p.name === "proj-A");
    expect(projA?.events).toBe(2);
    expect(projA?.sessions).toBe(2);
    expect(projA?.outputTokens).toBe(200_000);
  });

  it("sorts projects by descending costUsd", () => {
    insertEvent(db, {
      sessionFile: "/u/proj/a/s.jsonl",
      tsMs: todayStartMs + 1,
      outputTokens: 50_000,
    });
    insertEvent(db, {
      sessionFile: "/u/proj/b/s.jsonl",
      tsMs: todayStartMs + 2,
      outputTokens: 500_000,
    });
    const result = aggregateByProject(db, PRICING, 30, now);
    expect(result.projects[0]?.name).toBe("b");
    expect(result.projects[1]?.name).toBe("a");
  });

  it("fills dailyCostUsd with cost-per-day positioned by tsMs in the window", () => {
    // 3-day window: days[0] = 2026-05-18, days[1] = 2026-05-19, days[2] = 2026-05-20
    insertEvent(db, {
      sessionFile: "/u/p/x/s.jsonl",
      tsMs: todayStartMs - 2 * day + 1000, // day 0 (2026-05-18)
      outputTokens: 100_000,
      reqSuffix: "a",
    });
    insertEvent(db, {
      sessionFile: "/u/p/x/s.jsonl",
      tsMs: todayStartMs + 1000, // day 2 (today)
      outputTokens: 200_000,
      reqSuffix: "b",
    });
    const result = aggregateByProject(db, PRICING, 3, now);
    expect(result.projects).toHaveLength(1);
    const arr = result.projects[0]?.dailyCostUsd ?? [];
    expect(arr).toHaveLength(3);
    expect(arr[0]).toBeGreaterThan(0); // 2026-05-18
    expect(arr[1]).toBe(0); // 2026-05-19
    expect(arr[2]).toBeGreaterThan(arr[0] ?? 0); // today, with more tokens
  });

  it("counts distinct sessions per project", () => {
    insertEvent(db, {
      sessionFile: "/u/p/a/s-1.jsonl",
      tsMs: todayStartMs + 1,
      outputTokens: 1000,
    });
    insertEvent(db, {
      sessionFile: "/u/p/a/s-1.jsonl",
      tsMs: todayStartMs + 2,
      outputTokens: 1000,
      reqSuffix: "x",
    });
    insertEvent(db, {
      sessionFile: "/u/p/a/s-2.jsonl",
      tsMs: todayStartMs + 3,
      outputTokens: 1000,
    });
    const result = aggregateByProject(db, PRICING, 30, now);
    expect(result.projects[0]?.events).toBe(3);
    expect(result.projects[0]?.sessions).toBe(2);
  });

  it("v0.29.0: sums linesAdded/linesRemoved and computes outputPerLine", () => {
    insertEvent(db, {
      sessionFile: "/u/p/a/s.jsonl",
      tsMs: todayStartMs + 1,
      outputTokens: 10_000,
      linesAdded: 100,
      linesRemoved: 30,
    });
    insertEvent(db, {
      sessionFile: "/u/p/a/s.jsonl",
      tsMs: todayStartMs + 2,
      outputTokens: 5_000,
      linesAdded: 50,
      linesRemoved: 10,
      reqSuffix: "x",
    });
    const p = aggregateByProject(db, PRICING, 30, now).projects[0];
    expect(p?.linesAdded).toBe(150);
    expect(p?.linesRemoved).toBe(40);
    expect(p?.outputPerLine).toBeCloseTo(15_000 / 150, 6);
  });

  it("v0.29.0: outputPerLine is 0 when no lines were added", () => {
    insertEvent(db, {
      sessionFile: "/u/p/a/s.jsonl",
      tsMs: todayStartMs + 1,
      outputTokens: 1234,
    });
    const p = aggregateByProject(db, PRICING, 30, now).projects[0];
    expect(p?.outputPerLine).toBe(0);
  });

  it("v0.29.0: activeMs sums small intra-session gaps + a per-session tail", () => {
    const min = 60_000;
    insertEvent(db, { sessionFile: "/u/p/a/s.jsonl", tsMs: todayStartMs, outputTokens: 1 });
    insertEvent(db, {
      sessionFile: "/u/p/a/s.jsonl",
      tsMs: todayStartMs + 2 * min, // 2-min gap, counted
      outputTokens: 1,
      reqSuffix: "b",
    });
    insertEvent(db, {
      sessionFile: "/u/p/a/s.jsonl",
      tsMs: todayStartMs + 30 * min, // 28-min gap, dropped (over 5 min)
      outputTokens: 1,
      reqSuffix: "c",
    });
    const p = aggregateByProject(db, PRICING, 30, now).projects[0];
    expect(p?.activeMs).toBe(2 * min + 1 * min); // gap=2m + tail=1m
  });

  it("v0.29.0: dailyByFamily splits output tokens by model family", () => {
    insertEvent(db, {
      sessionFile: "/u/p/a/s.jsonl",
      tsMs: todayStartMs + 1,
      outputTokens: 1000,
      model: "claude-opus-4-7",
    });
    insertEvent(db, {
      sessionFile: "/u/p/a/s.jsonl",
      tsMs: todayStartMs + 2,
      outputTokens: 500,
      model: "claude-sonnet-4-6",
      reqSuffix: "s",
    });
    const p = aggregateByProject(db, PRICING, 3, now).projects[0];
    const opus = p?.dailyByFamily.opus ?? [];
    const sonnet = p?.dailyByFamily.sonnet ?? [];
    expect(opus[opus.length - 1]).toBe(1000);
    expect(sonnet[sonnet.length - 1]).toBe(500);
  });
});

describe("modelFamily (v0.29.0)", () => {
  it("buckets opus / sonnet / haiku by substring", () => {
    expect(modelFamily("claude-opus-4-7")).toBe("opus");
    expect(modelFamily("claude-sonnet-4-6-20260101")).toBe("sonnet");
    expect(modelFamily("claude-haiku-4-5")).toBe("haiku");
  });
  it("returns 'other' for unrecognised models (e.g. custom proxies)", () => {
    expect(modelFamily("gpt-4-turbo")).toBe("other");
    expect(modelFamily("")).toBe("other");
    expect(modelFamily("local-model-v1")).toBe("other");
  });
});
