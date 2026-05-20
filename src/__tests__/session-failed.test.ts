import { describe, expect, it } from "vitest";
import type { SessionFailure } from "../acp/session-manager.js";
import { checkSessionFailed } from "../rules/session-failed.js";

const FAILURE: SessionFailure = {
  sessionId: "sess-abc123def456",
  cwd: "/home/user/projects/aegis",
  reason: "Request timeout after 300000ms",
  atMs: 1_700_000_000_000,
};

describe("checkSessionFailed", () => {
  it("returns empty when there are no failures", () => {
    expect(checkSessionFailed({ failuresSource: () => [] })).toEqual([]);
  });

  it("emits one RuleMatch per failure with sessionId-prefixed ruleName", () => {
    const matches = checkSessionFailed({ failuresSource: () => [FAILURE] });
    expect(matches).toHaveLength(1);
    expect(matches[0]?.ruleName).toBe(`session-failed:${FAILURE.sessionId}`);
  });

  it("uses atMs as the dedupKey so the same session can fail twice on the same day", () => {
    const failure2 = { ...FAILURE, atMs: FAILURE.atMs + 60_000 };
    const matches = checkSessionFailed({ failuresSource: () => [FAILURE, failure2] });
    expect(matches[0]?.dedupKey).toBe(String(FAILURE.atMs));
    expect(matches[1]?.dedupKey).toBe(String(failure2.atMs));
    expect(matches[0]?.dedupKey).not.toBe(matches[1]?.dedupKey);
  });

  it("includes session id (truncated), cwd, and reason in the message", () => {
    const matches = checkSessionFailed({ failuresSource: () => [FAILURE] });
    expect(matches[0]?.message).toContain("session failed");
    expect(matches[0]?.message).toContain("sess-abc123d"); // first 12 chars
    expect(matches[0]?.message).toContain("/home/user/projects/aegis");
    expect(matches[0]?.message).toContain("Request timeout after 300000ms");
  });

  it("truncates very long reasons and cwds to keep the message readable", () => {
    const longReason = "x".repeat(500);
    const longCwd = `/${"y".repeat(200)}`;
    const matches = checkSessionFailed({
      failuresSource: () => [{ ...FAILURE, cwd: longCwd, reason: longReason }],
    });
    const msg = matches[0]?.message ?? "";
    expect(msg).toContain("…");
    expect(msg.length).toBeLessThan(longReason.length + longCwd.length);
  });
});
