import { describe, expect, it } from "vitest";
import { openDb } from "../db.js";

describe("PolarisDb acp_sessions + session_messages (v0.18.0)", () => {
  it("upsertAcpSession is insert on first call, partial-update on second", () => {
    const db = openDb(":memory:");
    try {
      db.upsertAcpSession({
        id: "sess-1",
        cwd: "/tmp/a",
        createdAt: 1000,
        lastActivityAt: 1000,
        status: "idle",
        endedAt: null,
        endReason: null,
        settingsJson: JSON.stringify({ mcpServers: ["fs"] }),
      });
      let row = db.getAcpSession("sess-1");
      expect(row?.cwd).toBe("/tmp/a");
      expect(row?.status).toBe("idle");
      expect(row?.endedAt).toBeNull();

      db.upsertAcpSession({
        id: "sess-1",
        cwd: "/tmp/a",
        createdAt: 1000,
        lastActivityAt: 2000,
        status: "prompting",
        endedAt: null,
        endReason: null,
        settingsJson: null,
      });
      row = db.getAcpSession("sess-1");
      expect(row?.lastActivityAt).toBe(2000);
      expect(row?.status).toBe("prompting");
      expect(row?.settingsJson).toBe(JSON.stringify({ mcpServers: ["fs"] }));
    } finally {
      db.close();
    }
  });

  it("closeAcpSession sets endedAt + endReason, but only on the first call", () => {
    const db = openDb(":memory:");
    try {
      db.upsertAcpSession({
        id: "sess-2",
        cwd: "/x",
        createdAt: 1,
        lastActivityAt: 1,
        status: "idle",
        endedAt: null,
        endReason: null,
        settingsJson: null,
      });
      db.closeAcpSession("sess-2", 100, "deleted");
      let row = db.getAcpSession("sess-2");
      expect(row?.status).toBe("closed");
      expect(row?.endedAt).toBe(100);
      expect(row?.endReason).toBe("deleted");
      db.closeAcpSession("sess-2", 200, "manager-close");
      row = db.getAcpSession("sess-2");
      expect(row?.endedAt).toBe(100);
      expect(row?.endReason).toBe("deleted");
    } finally {
      db.close();
    }
  });

  it("listAcpSessions returns sessions ordered by createdAt DESC", () => {
    const db = openDb(":memory:");
    try {
      const base = {
        cwd: "/x",
        lastActivityAt: 0,
        status: "idle",
        endedAt: null,
        endReason: null,
        settingsJson: null,
      };
      db.upsertAcpSession({ id: "old", createdAt: 100, ...base });
      db.upsertAcpSession({ id: "new", createdAt: 300, ...base });
      db.upsertAcpSession({ id: "mid", createdAt: 200, ...base });
      const rows = db.listAcpSessions();
      expect(rows.map((r) => r.id)).toEqual(["new", "mid", "old"]);
    } finally {
      db.close();
    }
  });

  it("appendSessionMessage + getSessionMessages preserve insert order and filter by sessionId", () => {
    const db = openDb(":memory:");
    try {
      db.appendSessionMessage({
        sessionId: "a",
        tsMs: 1,
        kind: "agent_message",
        payloadJson: JSON.stringify({ text: "hi" }),
      });
      db.appendSessionMessage({
        sessionId: "a",
        tsMs: 2,
        kind: "tool_call",
        payloadJson: JSON.stringify({ title: "Bash" }),
      });
      db.appendSessionMessage({
        sessionId: "b",
        tsMs: 1,
        kind: "agent_message",
        payloadJson: JSON.stringify({ text: "other" }),
      });
      const aRows = db.getSessionMessages("a");
      expect(aRows.map((r) => r.kind)).toEqual(["agent_message", "tool_call"]);
      const bRows = db.getSessionMessages("b");
      expect(bRows).toHaveLength(1);
      expect(bRows[0]?.payloadJson).toContain("other");
    } finally {
      db.close();
    }
  });
});
