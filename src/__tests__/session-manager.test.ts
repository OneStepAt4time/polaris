import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type SessionEvent,
  type SessionManager,
  createSessionManager,
} from "../acp/session-manager.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(here, "fixtures", "acp-mock-server.mjs");
const fixtureBin = `"${process.execPath}" "${fixturePath}"`;

async function waitFor<T>(predicate: () => T | undefined, timeoutMs = 2000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value !== undefined) return value;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("waitFor timed out");
}

describe("createSessionManager", () => {
  let mgr: SessionManager;

  beforeEach(() => {
    mgr = createSessionManager({ binCmd: fixtureBin });
  });

  afterEach(async () => {
    await mgr.close();
  });

  it("createSession returns a record with id, status=idle, and empty updates", async () => {
    const rec = await mgr.createSession({ cwd: "/tmp/proj" });
    expect(rec.id).toMatch(/^fixture-session-\d+$/);
    expect(rec.cwd).toBe("/tmp/proj");
    expect(rec.status).toBe("idle");
    expect(rec.updates).toEqual([]);
    expect(rec.createdAt).toBeGreaterThan(0);
  });

  it("createSession allocates distinct IDs across calls", async () => {
    const a = await mgr.createSession({ cwd: "/tmp/a" });
    const b = await mgr.createSession({ cwd: "/tmp/b" });
    expect(a.id).not.toBe(b.id);
  });

  it("getSession returns a snapshot, listSessions returns all", async () => {
    const a = await mgr.createSession({ cwd: "/tmp/a" });
    const b = await mgr.createSession({ cwd: "/tmp/b" });
    expect(mgr.getSession(a.id)?.cwd).toBe("/tmp/a");
    expect(mgr.getSession(b.id)?.cwd).toBe("/tmp/b");
    expect(
      mgr
        .listSessions()
        .map((s) => s.id)
        .sort(),
    ).toEqual([a.id, b.id].sort());
  });

  it("getSession returns undefined for unknown ids", async () => {
    expect(mgr.getSession("does-not-exist")).toBeUndefined();
  });

  it("sendPrompt returns stopReason and the streamed updates", async () => {
    const rec = await mgr.createSession({ cwd: "/tmp/p" });
    const result = await mgr.sendPrompt(rec.id, "hello");
    expect(result.stopReason).toBe("end_turn");
    expect(result.updates).toHaveLength(2);
    expect(result.updates[0]?.payload).toMatchObject({
      method: "session/update",
      params: { kind: "thinking" },
    });
    expect(result.updates[1]?.payload).toMatchObject({
      method: "session/update",
      params: { kind: "agent_message", text: "echo:hello" },
    });
  });

  it("server-initiated permission request becomes a pending approval", async () => {
    const rec = await mgr.createSession({ cwd: "/tmp/p" });
    const events: SessionEvent[] = [];
    mgr.subscribe(rec.id, (e) => events.push(e));
    const promptPromise = mgr.sendPrompt(rec.id, "ask-permission");
    // Wait for the approval-request event to land.
    const approvalEvent = await waitFor(() =>
      events.find(
        (e): e is Extract<SessionEvent, { type: "approval-request" }> =>
          e.type === "approval-request",
      ),
    );
    expect(mgr.listApprovals(rec.id)).toHaveLength(1);
    const fetched = mgr.getApproval(rec.id, approvalEvent.approval.approvalId);
    expect(fetched?.method).toBe("session/request_permission");

    const ok = mgr.respondToApproval(rec.id, approvalEvent.approval.approvalId, {
      outcome: "selected",
      optionId: "allow",
    });
    expect(ok).toBe(true);
    expect(mgr.listApprovals(rec.id)).toHaveLength(0);

    const result = await promptPromise;
    expect(result.stopReason).toBe("end_turn");
  });

  it("respondToApproval returns false for unknown approval id", async () => {
    const rec = await mgr.createSession({ cwd: "/tmp/p" });
    expect(mgr.respondToApproval(rec.id, "no-such-approval", { outcome: "cancelled" })).toBe(false);
  });

  it("subscribe receives update events during a prompt", async () => {
    const rec = await mgr.createSession({ cwd: "/tmp/p" });
    const events: SessionEvent[] = [];
    const unsubscribe = mgr.subscribe(rec.id, (e) => events.push(e));
    await mgr.sendPrompt(rec.id, "hello");
    unsubscribe();
    const updates = events.filter((e) => e.type === "update");
    expect(updates).toHaveLength(2);
  });

  it("subscribe returns no-op unsubscribe for unknown session", () => {
    const unsub = mgr.subscribe("nope", () => {});
    expect(typeof unsub).toBe("function");
    unsub();
  });

  it("deleteSession resolves any pending approval with an error response", async () => {
    const rec = await mgr.createSession({ cwd: "/tmp/p" });
    const events: SessionEvent[] = [];
    mgr.subscribe(rec.id, (e) => events.push(e));
    const promptPromise = mgr.sendPrompt(rec.id, "ask-permission").catch((err: Error) => err);
    await waitFor(() => events.find((e) => e.type === "approval-request"));
    expect(mgr.listApprovals(rec.id)).toHaveLength(1);
    await mgr.deleteSession(rec.id);
    const result = await promptPromise;
    // The prompt request to the agent rejects because we deleted before it
    // could finish. We don't care which error, just that the promise settles.
    expect(result).toBeDefined();
  });

  it("approval timeout auto-cancels and unblocks the prompt", async () => {
    const fast = createSessionManager({ binCmd: fixtureBin, approvalTimeoutMs: 100 });
    try {
      const rec = await fast.createSession({ cwd: "/tmp/p" });
      const result = await fast.sendPrompt(rec.id, "ask-permission");
      expect(result.stopReason).toBe("end_turn");
      expect(fast.listApprovals(rec.id)).toHaveLength(0);
    } finally {
      await fast.close();
    }
  });

  it("sendPrompt rejects unknown session id", async () => {
    await expect(mgr.sendPrompt("nope", "hi")).rejects.toThrow(/Unknown session/);
  });

  it("sendPrompt rejects when session is closed", async () => {
    const rec = await mgr.createSession({ cwd: "/tmp/p" });
    await mgr.deleteSession(rec.id);
    await expect(mgr.sendPrompt(rec.id, "hi")).rejects.toThrow(/Unknown session/);
  });

  it("deleteSession is idempotent and removes the record", async () => {
    const rec = await mgr.createSession({ cwd: "/tmp/p" });
    await mgr.deleteSession(rec.id);
    await mgr.deleteSession(rec.id);
    expect(mgr.getSession(rec.id)).toBeUndefined();
  });

  it("createSession throws after close()", async () => {
    await mgr.close();
    await expect(mgr.createSession({ cwd: "/tmp/p" })).rejects.toThrow(/closed/);
  });

  it("sendPrompt failures land in recentFailures() (v0.15.0)", async () => {
    expect(mgr.recentFailures()).toEqual([]);
    const rec = await mgr.createSession({ cwd: "/tmp/p" });
    await expect(mgr.sendPrompt(rec.id, "fail-prompt")).rejects.toThrow(/simulated prompt failure/);
    const failures = mgr.recentFailures();
    expect(failures).toHaveLength(1);
    expect(failures[0]?.sessionId).toBe(rec.id);
    expect(failures[0]?.cwd).toBe("/tmp/p");
    expect(failures[0]?.reason).toContain("simulated prompt failure");
    expect(failures[0]?.atMs).toBeGreaterThan(0);
  });

  it("session snapshot exposes pendingApprovalsCount (v0.20.0)", async () => {
    const rec = await mgr.createSession({ cwd: "/tmp/p" });
    expect(rec.pendingApprovalsCount).toBe(0);
    const events: SessionEvent[] = [];
    mgr.subscribe(rec.id, (e) => events.push(e));
    const promptPromise = mgr.sendPrompt(rec.id, "ask-permission").catch((err: Error) => err);
    await waitFor(() => events.find((e) => e.type === "approval-request"));
    const snap = mgr.getSession(rec.id);
    expect(snap?.pendingApprovalsCount).toBe(1);
    // Cleanup: respond so the prompt resolves before afterEach closes.
    const approvals = mgr.listApprovals(rec.id);
    if (approvals[0]) {
      mgr.respondToApproval(rec.id, approvals[0].approvalId, {
        outcome: "selected",
        optionId: "allow",
      });
    }
    await promptPromise;
  });

  it("createSession reads .mcp.json + CLAUDE.md from cwd and surfaces settings (v0.17.0)", async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const fixtureDir = mkdtempSync(resolve(tmpdir(), "polaris-projset-"));
    try {
      writeFileSync(resolve(fixtureDir, "CLAUDE.md"), "# rules\n");
      mkdirSync(resolve(fixtureDir, ".claude"));
      writeFileSync(resolve(fixtureDir, ".claude", "settings.json"), "{}");
      writeFileSync(
        resolve(fixtureDir, ".mcp.json"),
        JSON.stringify({
          mcpServers: { fsmcp: { command: "uvx", args: ["mcp-server-fs"] } },
        }),
      );
      const rec = await mgr.createSession({ cwd: fixtureDir });
      expect(rec.settings?.claudeMdDetected).toBe(true);
      expect(rec.settings?.claudeSettingsDetected).toBe(true);
      expect(rec.settings?.mcpServers).toEqual(["fsmcp"]);
      expect(rec.settings?.warnings).toEqual([]);
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });
});
