import { describe, expect, it } from "vitest";
import type { FetchLike } from "../channels/channel.js";
import { sendDiscordMessage } from "../channels/discord.js";
import { sendSlackMessage } from "../channels/slack.js";

interface Capture {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

function makeFetch(reply: { ok: boolean; status: number; body?: string }): {
  calls: Capture[];
  fetch: FetchLike;
} {
  const calls: Capture[] = [];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, method: init.method, headers: init.headers, body: init.body });
      return {
        ok: reply.ok,
        status: reply.status,
        text: async () => reply.body ?? "",
      };
    },
  };
}

describe("sendSlackMessage", () => {
  it("POSTs to the webhook URL with a JSON {text} body", async () => {
    const { calls, fetch } = makeFetch({ ok: true, status: 200 });
    const res = await sendSlackMessage(
      { webhookUrl: "https://hooks.slack.com/services/T/X/Y" },
      "*Polaris* — hi",
      fetch,
    );
    expect(res.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://hooks.slack.com/services/T/X/Y");
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ text: "*Polaris* — hi" });
  });

  it("returns ok:false with the response body on non-2xx", async () => {
    const { fetch } = makeFetch({ ok: false, status: 404, body: "no_such_webhook" });
    const res = await sendSlackMessage({ webhookUrl: "https://hooks/slack" }, "hi", fetch);
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
    expect(res.error).toContain("no_such_webhook");
  });

  it("returns ok:false with the thrown message on network error", async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error("ECONNRESET");
    };
    const res = await sendSlackMessage({ webhookUrl: "x" }, "hi", fetchImpl);
    expect(res.ok).toBe(false);
    expect(res.error).toBe("ECONNRESET");
  });
});

describe("sendDiscordMessage", () => {
  it("POSTs to the webhook URL with a JSON {content} body", async () => {
    const { calls, fetch } = makeFetch({ ok: true, status: 204 });
    const res = await sendDiscordMessage(
      { webhookUrl: "https://discord.com/api/webhooks/123/abc" },
      "Polaris alert",
      fetch,
    );
    expect(res.ok).toBe(true);
    expect(res.status).toBe(204);
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ content: "Polaris alert" });
  });

  it("returns ok:false with the response body on non-2xx", async () => {
    const { fetch } = makeFetch({ ok: false, status: 401, body: "Unauthorized" });
    const res = await sendDiscordMessage({ webhookUrl: "x" }, "hi", fetch);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("Unauthorized");
  });
});
