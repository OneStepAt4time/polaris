import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Channel, ChannelResult } from "../channels/channel.js";
import { makeTelegramChannel } from "../channels/telegram.js";
import { type PolarisDb, openDb } from "../db.js";
import type { PricingTable } from "../metrics/pricing.js";
import { checkApprovalNeeded, extractToolName } from "../rules/approval-needed.js";
import { evaluateRules, startEngine } from "../rules/engine.js";

const PRICING: PricingTable = {
  patterns: [{ match: "claude-test", input: 3, output: 15, cacheRead: 0.3 }],
  fallback: { input: 3, output: 15, cacheRead: 0.3 },
};

function seedHighCostToday(db: PolarisDb): void {
  const todayStartMs = new Date();
  todayStartMs.setUTCHours(0, 0, 0, 0);
  db.insertEvent({
    requestId: "rule-engine-test-evt",
    sessionFile: "/tmp/p/s.jsonl",
    tsMs: todayStartMs.getTime() + 60_000,
    model: "claude-test",
    inputTokens: 0,
    outputTokens: 1_000_000,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    rawCostUsd: null,
  });
}

interface RecordedSend {
  channel: string;
  text: string;
}

function recordingChannel(name: string, reply: ChannelResult, log: RecordedSend[]): Channel {
  return {
    name,
    send: async (text) => {
      log.push({ channel: name, text });
      return reply;
    },
  };
}

describe("evaluateRules", () => {
  let db: PolarisDb;

  beforeEach(() => {
    db = openDb(":memory:");
  });
  afterEach(() => {
    db.close();
  });

  it("returns empty when no rules are configured", () => {
    seedHighCostToday(db);
    const matches = evaluateRules(db, PRICING, {
      costThreshold: null,
      channels: [],
      intervalMs: 1000,
    });
    expect(matches).toEqual([]);
  });

  it("returns the cost-threshold match when configured and crossed", () => {
    seedHighCostToday(db);
    const matches = evaluateRules(db, PRICING, {
      costThreshold: { thresholdUsd: 5 },
      channels: [],
      intervalMs: 1000,
    });
    expect(matches).toHaveLength(1);
    expect(matches[0]?.ruleName).toBe("cost-threshold-daily");
  });

  // v0.27.0 — approval-needed rule
  it("returns one match per pending approval (v0.27.0)", () => {
    const approvals = [
      {
        sessionId: "aaaa-bbbb-cccc",
        cwd: "/home/user/project",
        approvalId: "ap-001",
        receivedAt: Date.now(),
        toolName: "Bash",
      },
      {
        sessionId: "dddd-eeee-ffff",
        cwd: "/home/user/other",
        approvalId: "ap-002",
        receivedAt: Date.now(),
        toolName: "Edit",
      },
    ];
    const matches = evaluateRules(db, PRICING, {
      costThreshold: null,
      approvalNeeded: { approvalsSource: () => approvals },
      channels: [],
      intervalMs: 1000,
    });
    expect(matches).toHaveLength(2);
    expect(matches[0]?.dedupKey).toBe("ap-001");
    expect(matches[0]?.ruleName).toMatch(/^approval-needed:/);
    expect(matches[0]?.message).toContain("Bash");
    expect(matches[1]?.dedupKey).toBe("ap-002");
    // v0.35.0 — Allow/Deny inline actions for inline-capable channels.
    expect(matches[0]?.inlineActions).toEqual([
      { id: "allow_once", label: "✓ Allow" },
      { id: "reject_once", label: "✕ Deny" },
    ]);
    expect(matches[0]?.correlationId).toBe("aaaa-bbbb-cccc:ap-001");
    expect(matches[1]?.correlationId).toBe("dddd-eeee-ffff:ap-002");
  });

  it("approval-needed: dedup suppresses the same approvalId on second tick", async () => {
    const approval = {
      sessionId: "sess-001",
      cwd: "/p",
      approvalId: "ap-dedup",
      receivedAt: Date.now(),
      toolName: "Bash",
    };
    const sends: RecordedSend[] = [];
    const engine = startEngine(db, PRICING, {
      costThreshold: null,
      approvalNeeded: { approvalsSource: () => [approval] },
      channels: [recordingChannel("mock", { ok: true, status: 200 }, sends)],
      intervalMs: 1000,
    });
    try {
      await engine.tick();
      await engine.tick();
    } finally {
      engine.stop();
    }
    // same approvalId — should only fire once
    expect(sends).toHaveLength(1);
  });
});

describe("startEngine().tick() — single Telegram channel", () => {
  let db: PolarisDb;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    db = openDb(":memory:");
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "{}",
    });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    db.close();
    vi.unstubAllGlobals();
  });

  it("dispatches via telegram and marks the notification as sent", async () => {
    seedHighCostToday(db);
    const logs: string[] = [];
    const engine = startEngine(
      db,
      PRICING,
      {
        costThreshold: { thresholdUsd: 5 },
        channels: [makeTelegramChannel({ botToken: "bot:abc", chatId: "555" })],
        intervalMs: 60 * 60 * 1000,
      },
      (m) => logs.push(m),
    );
    try {
      await engine.tick();
    } finally {
      engine.stop();
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const today = new Date().toISOString().slice(0, 10);
    expect(db.wasNotified("cost-threshold-daily", today)).toBe(true);
    expect(logs[0]).toContain("sent cost-threshold-daily");
    expect(logs[0]).toContain("telegram");
  });

  it("does not re-dispatch on a second tick within the same dedup window", async () => {
    seedHighCostToday(db);
    const engine = startEngine(db, PRICING, {
      costThreshold: { thresholdUsd: 5 },
      channels: [makeTelegramChannel({ botToken: "b", chatId: "c" })],
      intervalMs: 60 * 60 * 1000,
    });
    try {
      await engine.tick();
      await engine.tick();
    } finally {
      engine.stop();
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT mark the notification when the only channel fails", async () => {
    seedHighCostToday(db);
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "server error",
    });
    const logs: string[] = [];
    const engine = startEngine(
      db,
      PRICING,
      {
        costThreshold: { thresholdUsd: 5 },
        channels: [makeTelegramChannel({ botToken: "b", chatId: "c" })],
        intervalMs: 60 * 60 * 1000,
      },
      (m) => logs.push(m),
    );
    try {
      await engine.tick();
    } finally {
      engine.stop();
    }
    const today = new Date().toISOString().slice(0, 10);
    expect(db.wasNotified("cost-threshold-daily", today)).toBe(false);
    expect(logs[0]).toContain("failed cost-threshold-daily");
  });

  it("dispatches a rate-limit-near match per crossing window", async () => {
    db.insertRateLimitSample({
      tsMs: Date.now(),
      httpStatus: 200,
      rawJson: JSON.stringify({
        five_hour: { utilization: 95 },
        seven_day: { utilization: 85 },
        seven_day_opus: { utilization: 10 },
      }),
      error: null,
    });
    const engine = startEngine(db, PRICING, {
      costThreshold: null,
      rateLimitNear: { thresholdPct: 80 },
      channels: [makeTelegramChannel({ botToken: "b", chatId: "c" })],
      intervalMs: 60 * 60 * 1000,
    });
    try {
      await engine.tick();
    } finally {
      engine.stop();
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const today = new Date().toISOString().slice(0, 10);
    expect(db.wasNotified("rate-limit-near:five_hour", today)).toBe(true);
    expect(db.wasNotified("rate-limit-near:seven_day", today)).toBe(true);
    expect(db.wasNotified("rate-limit-near:seven_day_opus", today)).toBe(false);
  });
});

describe("startEngine().tick() — multi-channel fan-out", () => {
  let db: PolarisDb;

  beforeEach(() => {
    db = openDb(":memory:");
  });
  afterEach(() => {
    db.close();
  });

  it("delivers to every configured channel in parallel", async () => {
    seedHighCostToday(db);
    const sends: RecordedSend[] = [];
    const channels: Channel[] = [
      recordingChannel("telegram", { ok: true, status: 200 }, sends),
      recordingChannel("slack", { ok: true, status: 200 }, sends),
      recordingChannel("discord", { ok: true, status: 204 }, sends),
    ];
    const logs: string[] = [];
    const engine = startEngine(
      db,
      PRICING,
      { costThreshold: { thresholdUsd: 5 }, channels, intervalMs: 60 * 60 * 1000 },
      (m) => logs.push(m),
    );
    try {
      await engine.tick();
    } finally {
      engine.stop();
    }
    const today = new Date().toISOString().slice(0, 10);
    expect(sends).toHaveLength(3);
    expect(sends.map((s) => s.channel).sort()).toEqual(["discord", "slack", "telegram"]);
    expect(db.wasNotified("cost-threshold-daily", today)).toBe(true);
    expect(logs[0]).toMatch(/sent cost-threshold-daily.*telegram.*slack.*discord/);
  });

  it("marks notified on partial success (at least one channel delivers)", async () => {
    seedHighCostToday(db);
    const sends: RecordedSend[] = [];
    const channels: Channel[] = [
      recordingChannel("telegram", { ok: false, status: 500, error: "boom" }, sends),
      recordingChannel("slack", { ok: true, status: 200 }, sends),
    ];
    const logs: string[] = [];
    const engine = startEngine(
      db,
      PRICING,
      { costThreshold: { thresholdUsd: 5 }, channels, intervalMs: 60 * 60 * 1000 },
      (m) => logs.push(m),
    );
    try {
      await engine.tick();
    } finally {
      engine.stop();
    }
    const today = new Date().toISOString().slice(0, 10);
    expect(db.wasNotified("cost-threshold-daily", today)).toBe(true);
    expect(logs[0]).toContain("sent cost-threshold-daily");
    expect(logs[1]).toContain("partial failure on telegram");
  });

  it("does NOT mark notified when every channel fails (next tick retries)", async () => {
    seedHighCostToday(db);
    const sends: RecordedSend[] = [];
    const channels: Channel[] = [
      recordingChannel("telegram", { ok: false, error: "x" }, sends),
      recordingChannel("slack", { ok: false, error: "y" }, sends),
    ];
    const engine = startEngine(db, PRICING, {
      costThreshold: { thresholdUsd: 5 },
      channels,
      intervalMs: 60 * 60 * 1000,
    });
    try {
      await engine.tick();
    } finally {
      engine.stop();
    }
    const today = new Date().toISOString().slice(0, 10);
    expect(db.wasNotified("cost-threshold-daily", today)).toBe(false);
  });
});

describe("extractToolName (v0.27.0)", () => {
  it("reads toolUse.name (real claude-agent-acp shape)", () => {
    expect(extractToolName({ toolUse: { name: "Bash" } })).toBe("Bash");
  });
  it("reads toolCall.title as fallback", () => {
    expect(extractToolName({ toolCall: { title: "Read File" } })).toBe("Read File");
  });
  it("reads toolCall.toolName as fallback", () => {
    expect(extractToolName({ toolCall: { toolName: "Edit" } })).toBe("Edit");
  });
  it("reads toolCall.kind as last resort", () => {
    expect(extractToolName({ toolCall: { kind: "bash_execute" } })).toBe("bash_execute");
  });
  it("returns 'unknown' for null / non-object / empty", () => {
    expect(extractToolName(null)).toBe("unknown");
    expect(extractToolName({})).toBe("unknown");
    expect(extractToolName({ toolUse: { name: "" } })).toBe("unknown");
  });
});
