import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type SessionManager, createSessionManager } from "../acp/session-manager.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(here, "fixtures", "acp-mock-server.mjs");
const fixtureBin = `"${process.execPath}" "${fixturePath}"`;

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

  it("sendPrompt auto-denies server-initiated permission requests", async () => {
    const rec = await mgr.createSession({ cwd: "/tmp/p" });
    const result = await mgr.sendPrompt(rec.id, "ask-permission");
    expect(result.stopReason).toBe("end_turn");
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
});
