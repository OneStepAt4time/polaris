import { describe, expect, it } from "vitest";
import { parseCallbackData } from "../channels/telegram-poller.js";

describe("parseCallbackData (v0.35.0)", () => {
  it("parses the canonical polaris:{sessionId}:{approvalId}:{optionId} format", () => {
    const r = parseCallbackData(
      "polaris:b9c1ce92-1b1f-4f3e-aa17-1f44c4f7c0a4:5b54a7a7-7b3a-4d1c-9e26-3b1b6e0c9b09:allow_once",
    );
    expect(r).toEqual({
      sessionId: "b9c1ce92-1b1f-4f3e-aa17-1f44c4f7c0a4",
      approvalId: "5b54a7a7-7b3a-4d1c-9e26-3b1b6e0c9b09",
      optionId: "allow_once",
    });
  });

  it("treats anything between the first and last segment as the approvalId", () => {
    // Defensive: future format changes that add segments shouldn't break us.
    const r = parseCallbackData("polaris:sess:appr-with-extras:more:reject_once");
    expect(r).toEqual({
      sessionId: "sess",
      approvalId: "appr-with-extras:more",
      optionId: "reject_once",
    });
  });

  it("returns null for non-polaris prefixes", () => {
    expect(parseCallbackData("other:1:2:3")).toBeNull();
    expect(parseCallbackData("")).toBeNull();
  });

  it("returns null when any required segment is empty", () => {
    expect(parseCallbackData("polaris::appr:allow")).toBeNull();
    expect(parseCallbackData("polaris:sess::allow")).toBeNull();
    expect(parseCallbackData("polaris:sess:appr:")).toBeNull();
    expect(parseCallbackData("polaris:sess:appr")).toBeNull(); // missing optionId entirely
  });
});
